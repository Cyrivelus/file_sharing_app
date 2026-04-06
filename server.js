const express = require("express");
const multer = require("multer");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(cors());
app.use(express.json());

// Lecture sécurisée du mot de passe admin
const ADMIN_SECRET = process.env.ADMIN_SECRET || "CodeParDefautPourLeLocal123!";

// Connexion Pro à Supabase via variables d'environnement
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Utilisation de la mémoire pour l'upload temporaire
const upload = multer({ storage: multer.memoryStorage() });

// Servir le fichier HTML sur la route racine
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// 🔥 SOLUTION ERREUR 404 FAVICON : Répond proprement au navigateur
app.get("/favicon.ico", (req, res) => res.status(204).end());

// --- 1. Upload ---
app.post("/api/upload", upload.array("files"), async (req, res) => {
  const userId = req.headers["x-user-id"] || "anonymous";
  if (!req.files || req.files.length === 0)
    return res.status(400).send("Aucun fichier.");

  try {
    for (const file of req.files) {
      const fileId = uuidv4();
      const fileExt = path.extname(file.originalname);
      const fileNameInBucket = `${fileId}${fileExt}`;

      // A. Envoyer le fichier physique dans le Storage Supabase
      const { error: uploadError } = await supabase.storage
        .from("fichiers")
        .upload(fileNameInBucket, file.buffer, {
          contentType: file.mimetype,
        });

      if (uploadError) throw uploadError;

      const accessCode = Math.floor(1000 + Math.random() * 9000).toString();

      // B. Sauvegarder les métadonnées dans la DB Supabase
      const { error: dbError } = await supabase.from("files_meta").insert([
        {
          id: fileId,
          name: file.originalname,
          bucket_path: fileNameInBucket,
          mime_type: file.mimetype,
          owner: userId,
          access_code: accessCode,
        },
      ]);

      if (dbError) throw dbError;
    }

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erreur lors de l'upload vers Supabase" });
  }
});

// --- 2. Débloquer un fichier avec le code ---
app.post("/api/unlock", async (req, res) => {
  const { userId, code } = req.body;

  try {
    // A. Trouver le fichier qui correspond au code
    const { data: file, error } = await supabase
      .from("files_meta")
      .select("id, name")
      .eq("access_code", code)
      .single();

    if (error || !file) {
      return res.status(404).json({ error: "Code incorrect" });
    }

    // B. Enregistrer la permission d'accès pour cet utilisateur
    const { error: permError } = await supabase
      .from("permissions")
      .insert([{ user_id: userId, file_id: file.id }]);

    if (permError) throw permError;

    res.json({ success: true, fileName: file.name });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erreur lors du déverrouillage" });
  }
});

// --- 3. Liste des fichiers ---
app.get("/api/files", async (req, res) => {
  const userId = req.headers["x-user-id"];

  try {
    // A. Récupérer tous les fichiers du système
    const { data: allFiles, error } = await supabase
      .from("files_meta")
      .select("*");

    if (error) throw error;

    // B. Récupérer les IDs des fichiers débloqués par ce user
    const { data: myPerms } = await supabase
      .from("permissions")
      .select("file_id")
      .eq("user_id", userId);

    const unlockedFileIds = myPerms ? myPerms.map((p) => p.file_id) : [];

    // C. Filtrer : On montre les fichiers possédés OU débloqués
    const filteredFiles = allFiles.filter((f) => {
      const isOwner = f.owner === userId;
      const isUnlocked = unlockedFileIds.includes(f.id);
      return isOwner || isUnlocked;
    });

    const responseFiles = filteredFiles.map((f) => ({
      id: f.id,
      name: f.name,
      owner: f.owner,
      accessCode: f.access_code,
    }));

    res.json({ files: responseFiles, mode: "user" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Impossible de charger les fichiers" });
  }
});

// --- 4. Téléchargement ---
app.get("/api/download/:id", async (req, res) => {
  try {
    const { data: file, error } = await supabase
      .from("files_meta")
      .select("*")
      .eq("id", req.params.id)
      .single();

    if (error || !file) return res.status(404).send("Fichier introuvable");

    const { data, error: downloadError } = await supabase.storage
      .from("fichiers")
      .download(file.bucket_path);

    if (downloadError) throw downloadError;

    const buffer = Buffer.from(await data.arrayBuffer());

    res.setHeader("Content-Type", file.mime_type);
    res.setHeader("Content-Disposition", `attachment; filename="${file.name}"`);
    res.send(buffer);
  } catch (error) {
    res.status(500).send("Erreur lors du téléchargement");
  }
});

// --- 5. Suppression ---
app.delete("/api/delete/:id", async (req, res) => {
  try {
    // A. Récupérer les infos du fichier (notamment le chemin du bucket)
    const { data: file, error } = await supabase
      .from("files_meta")
      .select("*")
      .eq("id", req.params.id)
      .single();

    if (error || !file)
      return res.status(404).json({ error: "Fichier non trouvé" });

    // B. Supprimer le fichier physique du Storage Supabase
    const { error: storageError } = await supabase.storage
      .from("fichiers")
      .remove([file.bucket_path]);

    if (storageError) throw storageError;

    // C. Supprimer les métadonnées de la table PostgreSQL
    const { error: dbError } = await supabase
      .from("files_meta")
      .delete()
      .eq("id", req.params.id);

    if (dbError) throw dbError;

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erreur lors de la suppression" });
  }
});

// Export pour Vercel
module.exports = app;

const isVercel = process.env.VERCEL === "1";
if (!isVercel) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () =>
    console.log(`Serveur démarré : http://localhost:${PORT}`),
  );
}
