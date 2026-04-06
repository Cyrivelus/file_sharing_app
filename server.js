const express = require("express");
const multer = require("multer");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

const ADMIN_SECRET = "Cameroun2024!";

// Utilisation de la mémoire pour Vercel (indispensable en serverless)
const upload = multer({ storage: multer.memoryStorage() });

// Base de données temporaire en mémoire
let dbFiles = [];
let permissions = {};

// Servir le fichier HTML sur la route racine
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Toutes les routes API commencent maintenant par /api
// --- Upload ---
app.post("/api/upload", upload.array("files"), (req, res) => {
  const userId = req.headers["x-user-id"] || "anonymous";
  if (!req.files || req.files.length === 0)
    return res.status(400).send("Aucun fichier.");

  const newFiles = req.files.map((file) => {
    const fileData = {
      id: uuidv4(),
      name: file.originalname,
      buffer: file.buffer.toString("base64"), // Stockage en base64 dans la RAM
      mimeType: file.mimetype,
      owner: userId,
      accessCode: Math.floor(1000 + Math.random() * 9000).toString(),
    };
    dbFiles.push(fileData);
    return fileData;
  });

  res.json({ success: true });
});

// --- Déverrouiller un fichier ---
app.post("/api/unlock", (req, res) => {
  const { userId, code } = req.body;
  const file = dbFiles.find((f) => f.accessCode === code);

  if (!file) return res.status(404).json({ error: "Code incorrect" });

  if (!permissions[userId]) permissions[userId] = [];
  if (!permissions[userId].includes(file.id)) {
    permissions[userId].push(file.id);
  }
  res.json({ success: true, fileName: file.name });
});

// --- Liste des fichiers ---
app.get("/api/files", (req, res) => {
  const userId = req.headers["x-user-id"];
  const adminToken = req.headers["x-admin-token"];
  const isAdmin = adminToken === ADMIN_SECRET;
  const userPerms = permissions[userId] || [];

  const filteredFiles = isAdmin
    ? dbFiles
    : dbFiles.filter((f) => f.owner === userId || userPerms.includes(f.id));

  // On masque le buffer pour ne pas saturer le réseau lors du listing
  const responseFiles = filteredFiles.map((f) => ({
    id: f.id,
    name: f.name,
    owner: f.owner,
    accessCode: f.accessCode,
  }));

  res.json({ files: responseFiles, mode: isAdmin ? "admin" : "user" });
});

// --- Téléchargement ---
app.get("/api/download/:id", (req, res) => {
  const file = dbFiles.find((f) => f.id === req.params.id);
  if (!file) return res.status(404).send("Fichier introuvable");

  const fileBuffer = Buffer.from(file.buffer, "base64");
  res.setHeader("Content-Type", file.mimeType);
  res.setHeader("Content-Disposition", `attachment; filename="${file.name}"`);
  res.send(fileBuffer);
});

// --- Suppression ---
app.delete("/api/delete/:id", (req, res) => {
  const index = dbFiles.findIndex((f) => f.id === req.params.id);
  if (index !== -1) {
    dbFiles.splice(index, 1);
    return res.json({ success: true });
  }
  res.status(404).json({ error: "Fichier non trouvé" });
});

// Export pour Vercel
module.exports = app;

// Démarrage local
const isVercel = process.env.VERCEL === "1";
if (!isVercel) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () =>
    console.log(`Serveur démarré : http://localhost:${PORT}`),
  );
}
