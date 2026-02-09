// const express = require("express");
import express from "express";

import {registerController,loginController,testController,forgotPasswordController,updateProfileController,getProfileController} from '../controllers/authController.js'
import {requireSignIn,isAdmin} from '../middlewares/authMiddelware.js'


const router = express.Router();

//router.post("/register", requireSignIn,isAdmin,registerController);
router.post("/register",registerController);


router.post("/login", loginController);

router.post("/forgot-password", forgotPasswordController);

//middelware
router.get("/test", testController);

//protected user route auth
router.get("/user-auth", requireSignIn, (req, res) => {
    res.status(200).send({ ok: true });
  });

  
//protected admin route auth
router.get("/admin-auth", requireSignIn,isAdmin, (req, res) => {
    res.status(200).send({ ok: true });
  });

router.get("/me", requireSignIn, getProfileController);
//update profile
router.put("/profile", requireSignIn, updateProfileController);





export default router;

