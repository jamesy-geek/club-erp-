const bcrypt = require("bcryptjs");
const hashed = "$2a$10$46vP.btuNjKLDrzTE4x3bOqBJzEVT.paGWbm mqXt8gwQvLA07/Uoz6".replace(/\s/g, "");
const passwordInput = "7618704845";

bcrypt.compare(passwordInput, hashed, (err, res) => {
  if (err) console.error("Error:", err);
  console.log("Match:", res);
});
