import express from "express";

import Status from "../models/Status.js";
 
const router = express.Router();
 
// ADD STATUS

router.post("/", async (req, res) => {

  const status = await Status.create(req.body);

  res.json(status);

});
 
// GET ALL STATUS

router.get("/", async (req, res) => {

  const status = await Status.find().sort({ createdAt: -1 });

  res.json(status);

});
 
export default router;

 