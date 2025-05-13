var express = require("express");
var models = require("../models");
var Sequelize = require("sequelize");
const bcrypt = require("bcrypt");
const isAuthenticated = require("../utils/isAuthenticated");

const { generateUserToken } = require("../utils/tokenUtils")

var accountRoutes = express.Router();

accountRoutes.get("/login", (req, res) => {
  const errorMessage = req.query.errors || "";
  res.render("account/login", { error: errorMessage });
});

accountRoutes.get("/register", function (req, res) {
  res.render("account/register", { errors: "" });
});

accountRoutes.post("/register", function (req, res) {
  const email = req.body.email || "";

  let matched_users_promise;

  if (!email || email.length == 0) {
    matched_users_promise = models.User.findAll({
      where: { username: req.body.username },
    });
  } else {
    matched_users_promise = models.User.findAll({
      where: Sequelize.or({ username: req.body.username }, { email: email }),
    });
  }

  matched_users_promise.then(function (users) {
    if (users.length == 0) {
      const passwordHash = bcrypt.hashSync(req.body.password, 10);
      models.User.create({
        username: req.body.username,
        email: email,
        password: passwordHash,
      }).then(function (user) {
        setCookies(res, user.id);
        res.redirect("/profile?username=" + req.body.username);
      });
    } else {
      res.render("account/register", { errors: "Username or Email already in user" });
    }
  });
});

accountRoutes.post("/login", function (req, res) {
  if (req.body.username == null || req.body.username.length == 0) {
    handleUnsuccessfulLogin(res, "Please enter a username.");
    res.redirect("/login");
  }

  var matched_users_promise = models.User.findOne({
    where: Sequelize.and({ username: req.body.username }),
  });


  matched_users_promise
    .then(function (user) {
      if (isValidPassword(user, req.body.password)) {
        setCookies(res, user.id);
        res.redirect("/profile?username=" + req.body.username);
      } else {
        handleUnsuccessfulLogin(res);
      }
    })
    .catch(function (error) {
      console.error("Error during login:", error);
      handleUnsuccessfulLogin(res);
    });
});

function handleUnsuccessfulLogin(res, errorMessage = "Invalid username or password.") {
  res.render("account/login", { error: errorMessage });
}

const isValidPassword = (user, enteredPassword) => {
  return user && bcrypt.compareSync(enteredPassword, user.password);
};


const setCookies = (res, userId) => {
  // Cookie expires in 86400000 ms = 24 hours
  console.log("Set cookies");
  res.cookie("user_id", userId, { signed: true, httpOnly: true, sameSite: "strict", secure: true });
  res.cookie("token", generateUserToken(userId), {
    signed: false,
    httpOnly: true,
    maxAge: 86400000,
    sameSite: "strict",
    secure: true,
  });
};

async function getTopUsers(limit = 10) {
  try {
    const topUsers = await models.User.findAll({
      attributes: ['username', 'classified_file_count'],
      order: [['classified_file_count', 'DESC']],
      limit: limit
    });
    return topUsers;
  } catch (error) {
    console.error("Error fetching top users:", error);
    throw error;
  }
}

accountRoutes.get("/profile", async function (req, res) {
  const authenticated = isAuthenticated(req);
  console.log("Authenticated:", authenticated)
  // console.log("Session", req.session);
  if (!authenticated) {
    res.redirect("/login");
  } else {
    let username = req.query.username; // Get username from query parameters
    if (!username) {
      const user = await models.User.findOne({ where: { id: req.signedCookies.user_id } });
      username = user.username;
    }
    try {
      const topUsers = await getTopUsers(0); //Adjust this to get a table of the top users
      username=username.slice(4); //for batch testing only the number of user is required
      res.render("profile/profile", { username: username, topUsers: topUsers })
    } catch (error) {
      console.error("Error fetching top users:", error);
      res.render("profile/profile", { username: username })
    }
  }
});

accountRoutes.get("/logout", function (req, res) {
  // Clear cookies
  res.clearCookie("user_id");
  res.clearCookie("token");
  res.render("account/logout-success");  
});

module.exports = accountRoutes;