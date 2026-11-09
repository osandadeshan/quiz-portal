#!/usr/bin/env bash
# End-to-end smoke test for Quiz Portal against a THROWAWAY database.
# Never touches the developer's own database or .env.
#
#   bash .claude/skills/verify-quiz-portal/scripts/smoke.sh
#
# Flow: start temp Postgres (Docker) + app → create first admin → create quiz →
# invite 2 people → participant signs in, starts, answers, submits → checks the
# score, the ranking, admin privacy, one-browser-per-link and that correct answers
# never reach the browser. Cleans everything up on exit.
set -euo pipefail
# Never pipe a command into `grep -q`: grep exits at the first match, the writer
# gets SIGPIPE, and pipefail turns a match into a failure (or a "not found" into a
# false pass). Capture output in a variable and use `grep -q … <<<"$var"`.

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
PG_PORT="${SMOKE_PG_PORT:-54329}"
APP_PORT="${SMOKE_APP_PORT:-3999}"
B="http://localhost:$APP_PORT"
CONTAINER="quiz-portal-smoke-pg"
WORK="$(mktemp -d)"
APP_PID=""
PASS=0; FAIL=0

cleanup() {
  local status=$?
  if [ "$status" -ne 0 ] || [ "$FAIL" -ne 0 ]; then
    echo; echo "── last 30 lines of the server log ──"; tail -30 "$WORK/server.log" 2>/dev/null || true
  fi
  [ -n "$APP_PID" ] && kill "$APP_PID" 2>/dev/null || true
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

ok()   { echo "  ✓ $1"; PASS=$((PASS+1)); }
bad()  { echo "  ✗ $1"; FAIL=$((FAIL+1)); }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (expected '$3', got '$2')"; fi; }
csrf() { curl -s -b "$1" -c "$1" "$2" | grep -o 'name="csrf-token" content="[^"]*"' | sed 's/.*content="//;s/"//'; }
psqlq(){ docker exec "$CONTAINER" psql -U quiz -tAc "$1"; }

echo "▶ Starting throwaway Postgres on :$PG_PORT"
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
docker run -d --name "$CONTAINER" -e POSTGRES_USER=quiz -e POSTGRES_PASSWORD=quiz -e POSTGRES_DB=quiz -p "$PG_PORT:5432" postgres:16-alpine >/dev/null
for _ in $(seq 1 60); do docker exec "$CONTAINER" pg_isready -U quiz -q 2>/dev/null && break; sleep 0.5; done

if lsof -nP -iTCP:"$APP_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $APP_PORT is already in use. Stop that process or set SMOKE_APP_PORT." >&2; exit 1
fi
echo "▶ Starting app on :$APP_PORT"
( cd "$ROOT" && DATABASE_URL="postgres://quiz:quiz@localhost:$PG_PORT/quiz" PORT="$APP_PORT" APP_URL="$B" \
  SMTP_HOST= ADMIN_EMAIL= ADMIN_PASSWORD= NODE_ENV=development exec node app.js > "$WORK/server.log" 2>&1 ) &
APP_PID=$!
disown "$APP_PID" 2>/dev/null || true
for _ in $(seq 1 60); do curl -s -o /dev/null "$B/admin/login" && break; sleep 0.5; done

echo "▶ Admin"
A="$WORK/admin.jar"
T=$(csrf "$A" "$B/admin/setup")
code=$(curl -s -b "$A" -c "$A" -o /dev/null -w '%{http_code}' -d "_csrf=$T&name=Smoke+Admin&email=admin@example.com&password=supersecret1&confirm=supersecret1" "$B/admin/setup")
check "first-run setup creates admin" "$code" "302"
T=$(csrf "$A" "$B/admin")
QUIZ='{"title":"Smoke Quiz","description":"","durationMinutes":5,"shuffleOptions":true,"questions":[
 {"type":"single","text":"2+2?","options":[{"text":"3","correct":false},{"text":"4","correct":true},{"text":"5","correct":false}]},
 {"type":"yesno","text":"Is the sky blue?","options":[{"text":"Yes","correct":true},{"text":"No","correct":false}]},
 {"type":"multiple","text":"Primes?","options":[{"text":"2","correct":true},{"text":"3","correct":true},{"text":"4","correct":false}]}]}'
redirect=$(curl -s -b "$A" -c "$A" -H "Content-Type: application/json" -H "X-CSRF-Token: $T" -d "$QUIZ" "$B/admin/quizzes" | sed -n 's/.*"redirect":"\([^"]*\)".*/\1/p')
QID=$(echo "$redirect" | sed -n 's#.*/quizzes/\([0-9]*\).*#\1#p')
[ -n "$QID" ] && ok "quiz created (id $QID)" || bad "quiz creation"
bad_json=$(curl -s -b "$A" -H "Content-Type: application/json" -H "X-CSRF-Token: $T" -d '{"title":"","durationMinutes":0,"questions":[]}' "$B/admin/quizzes")
grep -q '"errors"' <<<"$bad_json" && ok "invalid quiz rejected" || bad "invalid quiz rejected"
code=$(curl -s -b "$A" -o /dev/null -w '%{http_code}' -H "Content-Type: application/json" -H "X-CSRF-Token: nope" -d "$QUIZ" "$B/admin/quizzes")
check "CSRF enforced" "$code" "403"

T=$(csrf "$A" "$B/admin/quizzes/$QID?tab=participants")
curl -s -b "$A" -c "$A" -o /dev/null --data-urlencode "_csrf=$T" --data-urlencode $'recipients=Alice <alice@example.com>\nbob@example.com' "$B/admin/quizzes/$QID/invite"
page=$(curl -s -b "$A" -c "$A" "$B/admin/quizzes/$QID?tab=participants")
rows=$(echo "$page" | grep -c 'data-share-row' || true)
check "share panel lists both invitations (no SMTP)" "$rows" "2"
links=($(echo "$page" | grep -o 'personal link: [^&]*' | sed 's#.*/q/##' | sort -u))
pws=($(echo "$page" | grep -o 'password: [A-Za-z0-9]*' | sed 's/password: //'))
[ "${#links[@]}" -ge 2 ] && [ "${pws[0]}" != "${pws[1]}" ] && ok "unique link + password per person" || bad "unique credentials"
# map password to link via the message order (Alice first)
L="${links[0]}"; P=""
for i in 0 1; do
  msg_link=$(echo "$page" | grep -o "personal link: [^&]*" | sed -n "$((i+1))p" | sed 's#.*/q/##')
  [ "$msg_link" = "$L" ] && P="${pws[$i]}"
done

echo "▶ Participant"
U="$WORK/p1.jar"
T=$(csrf "$U" "$B/q/$L")
code=$(curl -s -b "$U" -c "$U" -o /dev/null -w '%{http_code}' -d "_csrf=$T&password=wrong" "$B/q/$L")
check "wrong password rejected" "$code" "401"
T=$(csrf "$U" "$B/q/$L")
code=$(curl -s -b "$U" -c "$U" -o /dev/null -w '%{http_code}' -d "_csrf=$T&password=$P" "$B/q/$L")
check "participant sign-in" "$code" "302"
T=$(csrf "$U" "$B/q/$L/start")
curl -s -b "$U" -c "$U" -o /dev/null -d "_csrf=$T" "$B/q/$L/start"
take=$(curl -s -b "$U" -c "$U" "$B/q/$L/take")
grep -q 'is_correct\|"correct"' <<<"$take" && bad "correct answers leaked to browser" || ok "correct answers not sent to browser"
INV=$(psqlq "select id from invitations where token='$L'")
# answer: Q1 correct, Q2 wrong, Q3 correct
ANS=$(psqlq "select json_object_agg(q.id, (select array_agg(o.id) from options o where o.question_id=q.id and (case when q.position=1 then not o.is_correct else o.is_correct end))) from questions q where q.quiz_id=$QID")
T=$(echo "$take" | grep -o 'name="csrf-token" content="[^"]*"' | sed 's/.*content="//;s/"//')
saved=$(curl -s -b "$U" -c "$U" -H "Content-Type: application/json" -H "X-CSRF-Token: $T" -d "{\"answers\":$ANS}" "$B/q/$L/answers")
grep -q '"ok":true' <<<"$saved" && ok "autosave" || bad "autosave"

echo "▶ One browser per link"
U2="$WORK/p1b.jar"
T2=$(csrf "$U2" "$B/q/$L"); curl -s -b "$U2" -c "$U2" -o /dev/null -d "_csrf=$T2&password=$P" "$B/q/$L"
code=$(curl -s -b "$U" -o /dev/null -w '%{http_code}' -H "Accept: application/json" "$B/q/$L/ping")
check "first browser signed out after second sign-in" "$code" "401"
T2=$(csrf "$U2" "$B/q/$L/take")
curl -s -b "$U2" -c "$U2" -H "Content-Type: application/json" -H "X-CSRF-Token: $T2" -d '{"answers":{}}' "$B/q/$L/submit" >/dev/null
check "score (2 of 3, all-or-nothing)" "$(psqlq "select score||'/'||max_score from invitations where id=$INV")" "2/3"

echo "▶ Admin results & privacy"
results=$(curl -s -b "$A" "$B/admin/quizzes/$QID")
grep -q 'rank rank-1' <<<"$results" && ok "ranking shows participant" || bad "ranking"
code=$(curl -s -b "$A" -o /dev/null -w '%{http_code}' "$B/admin/quizzes/$QID/results.csv"); check "CSV export" "$code" "200"
T=$(csrf "$A" "$B/admin/team")
curl -s -b "$A" -c "$A" -o /dev/null -d "_csrf=$T&name=Other&email=other@example.com&password=otherpass1" "$B/admin/team"
O="$WORK/other.jar"; T=$(csrf "$O" "$B/admin/login")
curl -s -b "$O" -c "$O" -o /dev/null -d "_csrf=$T&email=other@example.com&password=otherpass1" "$B/admin/login"
code=$(curl -s -b "$O" -o /dev/null -w '%{http_code}' "$B/admin/quizzes/$QID"); check "other admin can't see quiz" "$code" "404"

echo "▶ Team roles"
check "first admin is the owner" "$(psqlq "select role from admins where email='admin@example.com'")" "owner"
OWNER_ID=$(psqlq "select id from admins where email='admin@example.com'")
OTHER_ID=$(psqlq "select id from admins where email='other@example.com'")
TO=$(csrf "$O" "$B/admin/team")
curl -s -b "$O" -c "$O" -o /dev/null -d "_csrf=$TO" "$B/admin/team/$OWNER_ID/delete"
check "non-owner can't remove the owner (and take their quizzes)" "$(psqlq "select count(*) from admins where id=$OWNER_ID")" "1"
curl -s -b "$O" -c "$O" -o /dev/null -d "_csrf=$TO&name=X&email=x@example.com&password=xxxxxxxx1" "$B/admin/team"
check "non-owner can't add admins" "$(psqlq "select count(*) from admins where email='x@example.com'")" "0"
TA=$(csrf "$A" "$B/admin/team")
curl -s -b "$A" -c "$A" -o /dev/null -d "_csrf=$TA" "$B/admin/team/$OTHER_ID/password"
NEWPW=$(curl -s -b "$A" -c "$A" "$B/admin/team" | grep -o 'data-copy="[A-Za-z0-9]\{12\}"' | head -1 | sed 's/data-copy="//;s/"//')
[ -n "$NEWPW" ] && ok "owner reset shows a one-time password" || bad "owner reset shows a one-time password"
code=$(curl -s -b "$O" -o /dev/null -w '%{http_code}' "$B/admin"); check "password reset signs that admin out" "$code" "302"
O2="$WORK/other2.jar"; T=$(csrf "$O2" "$B/admin/login")
code=$(curl -s -b "$O2" -c "$O2" -o /dev/null -w '%{redirect_url}' -d "_csrf=$T&email=other@example.com&password=$NEWPW" "$B/admin/login")
check "new password works" "$code" "$B/admin"

echo "▶ Hardening"
code=$(curl -s -o /dev/null -w '%{http_code}' "$B/healthz"); check "health check" "$code" "200"
TA=$(csrf "$A" "$B/admin")
code=$(curl -s -b "$A" -o /dev/null -w '%{http_code}' -H "Content-Type: application/json" -H "X-CSRF-Token: $TA" -d '{"title":"x","durationMinutes":5,"questions":[null,{"options":[null,7]}]}' "$B/admin/quizzes")
check "malformed quiz JSON gets 422, not a crash" "$code" "422"
parsed=$(cd "$ROOT" && node -e 'const u=require("./src/util");const r=u.parseRecipients("Smith, John <john@x.com>; a@x.com, b@x.com");process.stdout.write(r.valid.map(v=>v.email+"|"+v.name).join(","))')
check "Outlook-style 'Last, First <email>' parses" "$parsed" "john@x.com|Smith, John,a@x.com|,b@x.com|"
cellv=$(cd "$ROOT" && node -e 'process.stdout.write(require("./src/util").csvCell("=HYPERLINK(1)"))')
check "CSV formula injection neutralised" "$cellv" "\"'=HYPERLINK(1)\""
qpage=$(curl -s -b "$A" "$B/admin/quizzes/$QID?tab=questions")
grep -q 'answered correctly' <<<"$qpage" && ok "per-question stats shown" || bad "per-question stats shown"

echo "▶ Results visibility + cleared answers"
QUIZ2='{"title":"Exam","description":"","durationMinutes":5,"showResults":"none","questions":[
 {"type":"single","text":"Pick A","options":[{"text":"A","correct":true},{"text":"B","correct":false}]}]}'
QID2=$(curl -s -b "$A" -c "$A" -H "Content-Type: application/json" -H "X-CSRF-Token: $TA" -d "$QUIZ2" "$B/admin/quizzes" | sed -n 's#.*/quizzes/\([0-9]*\).*#\1#p')
check "show_results saved" "$(psqlq "select show_results from quizzes where id=$QID2")" "none"
T=$(csrf "$A" "$B/admin/quizzes/$QID2?tab=participants")
curl -s -b "$A" -c "$A" -o /dev/null --data-urlencode "_csrf=$T" --data-urlencode "recipients=carol@example.com" "$B/admin/quizzes/$QID2/invite"
page=$(curl -s -b "$A" -c "$A" "$B/admin/quizzes/$QID2?tab=participants")
L2=$(echo "$page" | grep -o 'personal link: [^&]*' | head -1 | sed 's#.*/q/##')
P2=$(echo "$page" | grep -o 'password: [A-Za-z0-9]*' | head -1 | sed 's/password: //')
C="$WORK/carol.jar"
T=$(csrf "$C" "$B/q/$L2"); curl -s -b "$C" -c "$C" -o /dev/null -d "_csrf=$T&password=$P2" "$B/q/$L2"
T=$(csrf "$C" "$B/q/$L2/start"); curl -s -b "$C" -c "$C" -o /dev/null -d "_csrf=$T" "$B/q/$L2/start"
Q2=$(psqlq "select id from questions where quiz_id=$QID2")
A2=$(psqlq "select id from options where question_id=$Q2 and is_correct")
T=$(csrf "$C" "$B/q/$L2/take")
curl -s -b "$C" -c "$C" -o /dev/null -H "Content-Type: application/json" -H "X-CSRF-Token: $T" -d "{\"answers\":{\"$Q2\":[$A2]}}" "$B/q/$L2/answers"
curl -s -b "$C" -c "$C" -o /dev/null -H "Content-Type: application/json" -H "X-CSRF-Token: $T" -d "{\"answers\":{\"$Q2\":[]}}" "$B/q/$L2/submit"
check "answer cleared at submit isn't scored from the autosave" "$(psqlq "select score from invitations where token='$L2'")" "0"
res=$(curl -s -b "$C" "$B/q/$L2/result")
grep -q "all done" <<<"$res" && ! grep -q 'Correct answer\|class="pct"' <<<"$res" && ok "'just a confirmation' hides score and answers" || bad "'just a confirmation' hides score and answers"

echo "▶ Pages render"
for u in /admin "/admin/quizzes/$QID?tab=results" "/admin/quizzes/$QID?tab=participants" "/admin/quizzes/$QID?tab=questions" "/admin/quizzes/$QID/edit" /admin/quizzes/new /admin/team /admin/account "/admin/attempts/$INV"; do
  code=$(curl -s -b "$A" -o /dev/null -w '%{http_code}' "$B$u"); check "GET $u" "$code" "200"
done
code=$(curl -s -b "$U2" -o /dev/null -w '%{http_code}' "$B/q/$L/result"); check "participant result page" "$code" "200"

if grep -qiE "^(Error|TypeError|ReferenceError)|Unhandled" "$WORK/server.log"; then bad "server log has errors"; grep -iE "error" "$WORK/server.log" | head -5; else ok "no errors in server log"; fi

echo; echo "Result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
