var express = require("express");
var bodyParser = require("body-parser");
var session = require("express-session");
var cookieParser = require("cookie-parser");
const favicon = require("serve-favicon");

const path = require("path");

const AccountRoutes = require("./controllers/account_controller");
const HomeRoutes = require("./controllers/home_controller");
const ClassifyRoutes = require("./controllers/classify_controller");
const postController = require("./controllers/post_controller");
const fileController = require("./controllers/file_controller");
const tutorialFileController = require("./controllers/tutorial_file_controller");
const authenticate = require("./middleware/authenticate");
// const profileController = require('./controllers/profile_controller');

// Configure express
var app = express(); // Add this line to create an instance of Express
app.use(favicon(path.join(__dirname, "public/images", "favicon.ico")));

console.log("Starting server in " + app.get("env") + " mode.");

// General configuration
app.set("view engine", "ejs");
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));  // Parse URL for key1=value1&key2=value2 etc.
app.set("views", path.join(__dirname, "views"));

COOKIE_SECRET = "randomstringsessionsecret";
app.use(cookieParser(COOKIE_SECRET));

app.use(express.static(path.join(__dirname, "public")));

// session secret to add a level of extra security
// app.use(
//   session({
//     secret: "randomstringsessionsecret", // Change this to a secure secret
//     resave: false,
//     saveUninitialized: true,
//     cookie: { secure: true, sessionID: null, signed: true, sameSite: "strict" }, // Set to true if using HTTPS
//   })
// );

// Set controllers
app.use("/", HomeRoutes);
app.use("/", AccountRoutes);
app.use("/", fileController);
app.use("/", postController);
app.use("/", authenticate, ClassifyRoutes);
app.use("/", tutorialFileController);

app.get("/login", (req, res) => {
  const error = req.query.error || null;
  res.render("login", { error });
});

const port = process.env.PORT || 8000;
const hostname = app.get("env") != "development" ? "0.0.0.0" : "localhost";

app.listen(port, hostname, () => {
  console.log(`Server is running on port ${port}`);
});
