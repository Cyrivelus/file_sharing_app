const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const ADMIN_SECRET = "Cameroun2024!"; 
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname))
});
const upload = multer({ storage });

let dbFiles = []; 
let permissions = {}; 

// --- NOUVEAU : Servir le fichier HTML sur la route "/" ---
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/upload', upload.array('files'), (req, res) => {
    const userId = req.headers['x-user-id'];
    if (!req.files) return res.status(400).send("Aucun fichier.");

    const newFiles = req.files.map(file => {
        return {
            id: path.parse(file.filename).name, 
            name: file.originalname,
            path: file.path,
            owner: userId,
            accessCode: Math.floor(1000 + Math.random() * 9000).toString()
        };
    });
    dbFiles.push(...newFiles);
    res.json({ success: true, files: newFiles });
});

app.post('/unlock', (req, res) => {
    const { userId, code } = req.body;
    const file = dbFiles.find(f => f.accessCode === code);
    
    if (!file) return res.status(404).json({ error: "Code incorrect" });
    
    if (!permissions[userId]) permissions[userId] = [];
    if (!permissions[userId].includes(file.id)) {
        permissions[userId].push(file.id);
    }
    res.json({ success: true, fileName: file.name });
});

app.get('/files', (req, res) => {
    const userId = req.headers['x-user-id'];
    const adminToken = req.headers['x-admin-token'];
    const isAdmin = (adminToken === ADMIN_SECRET);
    const userPerms = permissions[userId] || [];

    const filteredFiles = isAdmin 
        ? dbFiles 
        : dbFiles.filter(f => f.owner === userId || userPerms.includes(f.id));

    res.json({ files: filteredFiles, mode: isAdmin ? 'admin' : 'user' });
});

app.get('/download/:id', (req, res) => {
    const file = dbFiles.find(f => f.id === req.params.id);
    if (!file) return res.status(404).send('Introuvable');
    res.download(file.path, file.name);
});

app.delete('/delete/:id', (req, res) => {
    const index = dbFiles.findIndex(f => f.id === req.params.id);
    if (index !== -1) {
        if (fs.existsSync(dbFiles[index].path)) fs.unlinkSync(dbFiles[index].path);
        dbFiles.splice(index, 1);
    }
    res.json({ success: true });
});

app.listen(3000, () => console.log("Serveur démarré sur http://localhost:3000"));