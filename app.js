require("./src/server")
  .start()
  .catch((err) => {
    console.error("Failed to start:", err.message);
    process.exit(1);
  });
