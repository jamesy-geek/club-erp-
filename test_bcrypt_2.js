const bcrypt = require("bcryptjs");
const hashed = "$2a$10$46vP.btuNjKLDrzTE4x3bOqBJzEVT.paGWbm mqXt8gwQvLA07/Uoz6".replace(/\s/g, "");

bcrypt.compare("4ps25ee019", hashed, (err, res) => {
  console.log("Match with USN lowercase:", res);
});
bcrypt.compare("7618704845", hashed, (err, res) => {
  console.log("Match with phone number:", res);
});
