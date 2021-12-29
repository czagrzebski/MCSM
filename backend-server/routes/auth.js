const express = require('express');
const {createUser, login, getNewToken, verifyToken} = require('../controllers/authController');
const {userValidationRules, validate} = require('../controllers/validator');

const router = express.Router();

//POST - Create a new user (with validation middleware)
router.post('/create', userValidationRules(), validate, createUser);

//POST - Login User. Sends back access token and refresh token
router.post('/login', login)

//POST - Fetch a new access token
router.post('/token', getNewToken)

//TODO: Remove before pushing to prod.
//POST - Test Endpoint to Validate Authenticated State
router.post('/check', verifyToken, (req, res) => {
    res.send("Successfully Authenticated!");
})


module.exports = router;