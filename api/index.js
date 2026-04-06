const express = require("express");
const cors = require("cors");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");

const app = express();
app.use(cors());
app.use(express.json());

// Utilisation de la mémoire pour Vercel (Pas d'écriture disque)
const upload = multer({ storage: multer.memoryStorage() });

// Base de données temporaire en mémoire
let db = {
  files: [],
  unlocked: {}, // userId: [fileId]
};

// 1. Upload
app.post("/api/upload", upload.array("files"), (req, res) => {
  const userId = req.headers["x-user-id"];
  if (!req.files) return res.status(400).json({ error: "Aucun fichier" });

  req.files.forEach((file) => {
    const accessCode = Math.floor(1000 + Math.random() * 9000).toString();
    db.files.push({
      id: uuidv4(),
      name: file.originalname,
      buffer: file.buffer.toString("base64"), // Stockage base64 pour la mémoire
      mimeType: file.mimetype,
      owner: userId,
      accessCode: accessCode,
    });
  });
  res.json({ success: true });
});

// 2. Récupérer les fichiers
app.get("/api/files", (req, res) => {
  const userId = req.headers["x-user-id"];
  const adminToken = req.headers["x-admin-token"];

  let mode = "user";
  let visibleFiles = [];

  if (adminToken === "admin123") {
    // Mot de passe admin par défaut
    mode = "admin";
    visibleFiles = db.files;
  } else {
    const userUnlocked = db.unlocked[userId] || [];
    visibleFiles = db.files.filter(
      (f) => f.owner === userId || userUnlocked.includes(f.id),
    );
  }

  // On ne renvoie pas le buffer de données pour économiser la bande passante
  const responseFiles = visibleFiles.map((f) => ({
    id: f.id,
    name: f.name,
    owner: f.owner,
    accessCode: f.accessCode,
  }));

  res.json({ mode, files: responseFiles });
});

// 3. Débloquer un fichier avec code
app.post("/api/unlock", (req, res) => {
  const { userId, code } = req.body;
  const file = db.files.find((f) => f.accessCode === code);

  if (file) {
    if (!db.unlocked[userId]) db.unlocked[userId] = [];
    if (!db.unlocked[userId].includes(file.id)) {
      db.unlocked[userId].push(file.id);
    }
    res.json({ success: true, fileName: file.name });
  } else {
    res.json({ success: false });
  }
});

// 4. Télécharger
app.get("/api/download/:id", (req, res) => {
  const file = db.files.find((f) => f.id === req.params.id);
  if (!file) return res.status(404).send("Non trouvé");

  const fileBuffer = Buffer.from(file.buffer, "base64");
  res.setHeader("Content-Type", file.mimeType);
  res.setHeader("Content-Disposition", `attachment; filename="${file.name}"`);
  res.send(fileBuffer);
});

// 5. Supprimer
app.delete("/api/delete/:id", (req, res) => {
  const userId = req.headers["x-user-id"];
  const adminToken = req.headers["x-admin-token"];

  const fileIndex = db.files.findIndex((f) => f.id === req.params.id);
  if (fileIndex === -1) return res.status(404).send("Non trouvé");

  const file = db.files[fileIndex];
  if (file.owner === userId || adminToken === "admin123") {
    db.files.splice(fileIndex, 1);
    res.json({ success: true });
  } else {
    res.status(403).send("Interdit");
  }
});

module.exports = app;
