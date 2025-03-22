const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const dns = require("dns");
const net = require("net");

const app = express();
app.use(cors());
app.use(express.json());

// Serve the index file
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname,"public", "index.html"));
});

// ✅ Fix Multer: Increase file size limit to 5MB
const upload = multer({
    dest: "uploads/",
    limits: { fileSize: 5 * 1024 * 1024 }, // ✅ Allow up to 5MB files
});

// Handle file upload
app.post("/upload", upload.single("file"), async (req, res) => {
    console.log("File received:", req.file);

    if (!req.file) {
        return res.status(400).json({ error: "No file uploaded." });
    }

    // ✅ Check if the file is really a text or CSV file
    if (!req.file.originalname.endsWith(".csv") && !req.file.originalname.endsWith(".txt")) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: "Invalid file format. Please upload a CSV or TXT file." });
    }

    // ✅ Read the file properly
    let emails = [];
    const rl = readline.createInterface({
        input: fs.createReadStream(req.file.path),
        output: process.stdout,
        terminal: false
    });

    rl.on("line", (line) => {
        const email = line.trim();
        if (email) emails.push({ email });
    });

    rl.on("close", async () => {
        const validatedEmails = await validateEmails(emails);
        fs.unlinkSync(req.file.path); // ✅ Remove the uploaded file after processing
        res.json({ results: validatedEmails });
    });
});

// ✅ Fix MX Record & SMTP Validation (if needed)
async function validateEmails(emailList) {
    return Promise.all(emailList.map(async ({ email }) => {
        return await validateEmailSMTP(email);
    }));
}

function validateEmailSMTP(email) {
    return new Promise((resolve) => {
        const domain = email.split("@")[1];

        dns.resolveMx(domain, (err, addresses) => {
            if (err || !addresses || addresses.length === 0) {
                return resolve({ email, valid: false, reason: "No MX records found" });
            }

            const smtpServer = addresses[0].exchange;
            const socket = net.createConnection(25, smtpServer);

            socket.setTimeout(5000);

            socket.on("connect", () => {
                socket.write(`HELO ${domain}\r\n`);
                socket.write(`MAIL FROM:<test@${domain}>\r\n`);
                socket.write(`RCPT TO:<${email}>\r\n`);
                socket.write("QUIT\r\n");
            });

            socket.on("data", (data) => {
                const response = data.toString();
                if (response.includes("250")) {
                    resolve({ email, valid: true, reason: "Valid SMTP response" });
                } else {
                    resolve({ email, valid: false, reason: "Email rejected by server" });
                }
                socket.end();
            });

            socket.on("error", () => {
                resolve({ email, valid: false, reason: "SMTP connection failed" });
            });

            socket.on("timeout", () => {
                resolve({ email, valid: false, reason: "SMTP request timed out" });
                socket.destroy();
            });
        });
    });
}

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Server running on http://localhost:${PORT}`));