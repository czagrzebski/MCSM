const db = require("../config/db");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const decode = require("jwt-decode");

//TODO: Revoke Access/Refresh Token (need to implement a DB first)

//temporary solution for storing refresh tokens which
//only saves tokens for current runtime
//will use database/redis in the future
let refreshTokens = [];
const saltRounds = 10;

/**
 * Creates a user and stores it in the database
 * Checks if user does not exist and validates password
 */
async function createUser(req, res) {
  const { username, password } = req.body;

  //TODO: add this to validation middleware instead
  if (username.length === 0)
    return res.status(400).send("Username cannot be empty");

  //Fetch User
  const user = await db("USERS")
    .where("username", username)
    .first()
    .then((user) => {
      return user;
    })
    .catch((err) => {
      res.status(500).send("An unknown error has occurred");
    });

  //Check if that user already exists in the DB
  if (user) res.status(409).send("User already exists!");

  //Hash/Salt Password and store new user in DB
  bcrypt.hash(password, saltRounds, (err, hashedPassword) => {
    if (err) res.status(500).send("An unknown error occurred");

    //insert user into database
    db.insert({
      username: username,
      password: hashedPassword,
    })
      .into("USERS")
      .then((resp) => {
        res.status(201).send("User successfully created");
      })
      .catch((err) => res.status(400));
  });
}

/**
 * Generates Access Token and Refresh Token upon
 * successful authorization.
 */
async function login(req, res) {
  let { username, password } = req.body;

  //Remove unnecessary spacing
  username = username.trim();

  //Fetch User
  const user = await db("USERS")
    .where("username", username)
    .first()
    .then((user) => {
      return user;
    })
    .catch((err) => {
      res.status(500).send("An unknown error has occurred");
    });

  //User Does Not Exist in Database
  if (!user) {
    res.status(401).send("Invalid Credentials");
    return;
  }

  //Compare password to one stored in DB. If correct, issue a JWT.
  bcrypt.compare(password, user.password, function (err, result) {
    if (err) {
      res.status(500).send("An unknown error has occurred");
    }
    if (result) {
      const accessToken = generateAccessToken(user);
      const refreshToken = generateRefreshToken(user);

      refreshTokens[refreshToken] = user; //TODO: Store Token in DB

      //For Security, store refresh token as a cookie
      //Then keep access token in working memory for the frontend
      //TODO: Add 'secure' flag
      res.cookie("rft", refreshToken, { httpOnly: true, path: "/auth" });

      const response = {
        user: user.username,
        accessToken: accessToken,
      };

      res.status(200).json(response);
    } else {
      res.status(401).send("Invalid Credentials");
    }
  });
}

/**
 * Generates Access Token given Access Token Secret
 * and username
 */
function generateAccessToken(user) {
  return jwt.sign(
    { username: user.username, id: user.id },
    process.env.ACCESS_TOKEN_SECRET,
    {
      expiresIn: process.env.ACCESS_TOKEN_LIFE || "30m",
    }
  );
}

/**
 * Generates Refresh Token given Access Token Secret
 * and username
 */
function generateRefreshToken(user) {
  return jwt.sign(
    { username: user.username, id: user.id },
    process.env.ACCESS_TOKEN_SECRET,
    {
      expiresIn: process.env.REFRESH_TOKEN_LIFE || "7d",
    }
  );
}

/**
 * Deletes Refresh Token from Memory (eventually a DB)
 */
async function logout(req, res) {
  refreshTokens = refreshTokens.filter((token) => token !== req.cookies.rft);
  res.sendStatus(204);
}

/**
 * Issues a new Access Token given a valid refresh token
 */
async function getNewToken(req, res) {
  const refreshToken = req.cookies.rft;

  if (refreshToken == null) return res.sendStatus(401);

  if (refreshTokens[refreshToken] == null) return res.sendStatus(401);

  jwt.verify(refreshToken, process.env.ACCESS_TOKEN_SECRET, (err, user) => {
    if (err) {
      res.status(401).send("Invalid Token");
      return;
    }
    const accessToken = generateAccessToken(user);
    res.json({ accessToken: accessToken });
  });
}

async function deleteUser(req, res) {
  const { username } = req.body;
  const authHeader = req.headers["authorization"];

  const accessToken = authHeader && authHeader.split(" ")[1]; //check if auth header exists

  //Get the current user that made the request
  const decodedToken = decode(accessToken);

  //A user cannot delete itself
  if (decodedToken.username == username) {
    res.status(403).send("Cannot delete the account you are logged into");
    return;
  }

  db("USERS")
    .where("username", username)
    .del()
    .then((response) => {
      res.status(200).send("Successfully Deleted User");
      return;
    })
    .catch((err) => {
      next(new Error("Failed to delete user"));
    });
}

/**
 * Change a user's username and password
 */
async function editUser(req, res, next) {
  const { newUsername, newPassword, id } = req.body;

  //Hash/Salt Password and store new user in DB
  bcrypt.hash(newPassword, saltRounds, (err, hashedPassword) => {
    if (err) res.status(500).send("An unknown error occurred");

    db("USERS")
      .where("id", id)
      .update({ username: newUsername, password: hashedPassword })
      .then((response) => {
        res.status(200).send("User Updated");
        return;
      })
      .catch((err) => {
        next(new Error("Failed to update user"));
      });
  });
}

async function changePassword(req, res, next) {
  const { password, id } = req.body;

  //Hash/Salt Password and store new user in DB
  bcrypt.hash(password, saltRounds, (err, hashedPassword) => {
    if (err) res.status(500).send("An unknown error occurred");

    db("USERS")
      .where("id", id)
      .update({ password: hashedPassword })
      .then((response) => {
        res.status(200).send("User Password Updated");
        return;
      })
      .catch((err) => {
        next(new Error("Failed to update user password"));
      });
  });
}

async function changeUsername(req, res, next) {
  const { newUsername, id } = req.body;

  //Fetch User
  const user = await db("USERS")
    .where("username", newUsername)
    .first()
    .then((user) => {
      return user;
    })
    .catch((err) => {
      res.status(500).send("An unknown error has occurred");
    });

  //Username is already taken
  if (user) {
    next(new Error("Username already taken!"));
  }

  db("USERS")
    .where("id", id)
    .update({ username: newUsername })
    .then((response) => {
      res.status(200).send("User Updated");
      return;
    })
    .catch((err) => {
      next(new Error("Failed to update user"));
    });
}

/**
 * Middleware for Access Token Validation
 */
async function verifyToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1]; //check if auth header exists

  //check if token exists in request
  if (token == null) return res.status(401).send("Invalid Token");

  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, user) => {
    if (err) return res.status(401).send("Invalid Token");
    req.user = user;
    next();
  });
}

module.exports = {
  createUser,
  login,
  logout,
  getNewToken,
  verifyToken,
  deleteUser,
  editUser,
  changePassword,
  changeUsername,
};
