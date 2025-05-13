// controllers/tutorial_file_controller.js
const express = require("express");
const fs = require("fs");
const router = express.Router();
const path = require("path");
const config = require("../config/config.js");
const MAX_TUTORIAL_FILES = config.num_tutorial_files ?? 10;


let TUTORIAL_DATA_DIR_PATH = path.join(__dirname, "..", "tutorial_data");
if (!fs.existsSync(TUTORIAL_DATA_DIR_PATH)) {
  console.warn("Tutorial data directory not found. Using default path.");
  TUTORIAL_DATA_DIR_PATH = path.join(__dirname, "..", "data");
}


// Check if the tutorial_data directory exist
/**
 * Asynchronously retrieves a tutorial file based on the user's request and sends it as a response.
 */
async function getTutorialFileAndSendResponse(req, res) {
  console.log(req.params);
  const { fileIndex } = req.params; // Extract fileIndex
  console.log(fileIndex);
  let fileType = req.params.fileType;
  console.log("Received request for tutorial file:", fileType, "with index:", fileIndex);

  // Replace fileType data with "file", model with "model"
  if (fileType === "data") {
    fileType = "file";
    console.log("File type changed to:", fileType);
  }

  // Validate the fileIndex and calculate the modulo
  const index = parseInt(fileIndex, 10);
  if (isNaN(index)) {
    return res.status(400).json({ error: "Invalid file index." });
  }

  const tutorialFileId = index % MAX_TUTORIAL_FILES; // Calculate the file ID based on modulo
  const filePath = path.join(TUTORIAL_DATA_DIR_PATH, `${fileType}_${tutorialFileId}.csv.zlib`);

  console.log(`Serving tutorial file: ${filePath}`);

  // Send the file as a response
  res.setHeader("file_id", tutorialFileId);

  res.sendFile(filePath, (err) => {
    if (err) {
      console.error("Error sending file:", err);
      res.status(err.status || 500).json({ error: "File not found." });
    }
  });
}


router.get("/get_tutorial_:fileType/:fileIndex", async (req, res, next) => {
  await getTutorialFileAndSendResponse(req, res);
});


module.exports = router;
