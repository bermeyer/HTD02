// controllers/classification_controller.js
const express = require("express");
const user = require("../models/user");
const router = express.Router();
const config = require("../config/config.js");
const nr_users = config.nr_users;

// Route handler for /classify/classify and /classify/dark
router.get("/classify/:theme?", (req, res) => {

  const theme = req.params.theme || "classify";
  if(theme === "tutorial"){
    res.render(`classify/tutorial`);
    return;
  }
  const user_id = req.signedCookies.user_id;
  console.log("User ID:", user_id);
  if (user_id <= Math.floor(nr_users) ){
    res.render(`classify/${theme}`);
  } 
  else { //show the Probability panel
    res.render(`classify/${theme}_NNshow`);}
});

router.get("/waiting", (req, res) => {
  res.render("classify/waiting");
});
module.exports = router;
