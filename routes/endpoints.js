const router = require("express").Router();

const validateSignatue = require("../contrallers/validation");
const points = require("../contrallers/points");


router.post("/transactions", validateSignatue.getMethodName);
router.get("/getPointList", points.getPoints);
router.post("/getPoint", points.getPointsByWallet);

module.exports = router;