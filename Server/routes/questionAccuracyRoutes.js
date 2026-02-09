// // routes/questionAccuracyRoutes.js
// import express from "express";
// import { calculateAndStoreAccuracy } from "../controllers/questionAccuracyController.js";

// const router = express.Router();

// router.get("/calculate", calculateAndStoreAccuracy);

// export default router;


// routes/questionAccuracyRoutes.js
import express from "express";
import { calculateAndStoreAccuracy } from "../controllers/questionAccuracyController.js";

const router = express.Router();

// The controller calculates and stores (modifies the DB), so POST is the correct HTTP verb.
router.post("/calculate", calculateAndStoreAccuracy);

export default router;