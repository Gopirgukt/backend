const express = require("express");
const cors = require("cors");
const multer = require("multer");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 4000;
const UPLOAD_DIR = path.join(__dirname, "uploads");

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

app.use(cors({ origin: true }));
app.options("*", cors({ origin: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static(UPLOAD_DIR));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, `${uniqueSuffix}-${file.originalname}`);
  },
});

const upload = multer({ storage });

const db = new sqlite3.Database(path.join(__dirname, "students.db"), (err) => {
  if (err) {
    console.error("Database connection failed:", err.message);
  } else {
    console.log("Connected to SQLite database.");
  }
});

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      email TEXT UNIQUE,
      password TEXT,
      project_name TEXT,
      github_link TEXT,
      deploy_link TEXT,
      profile_image TEXT,
      project_image TEXT,
      ui_marks INTEGER,
      code_marks INTEGER,
      completion_marks INTEGER,
      feedback TEXT,
      status TEXT DEFAULT 'Pending',
      created_at TEXT
    )
  `);
});

app.post("/register", (req, res) => {
  const name = req.body.name?.trim();
  const email = req.body.email?.trim().toLowerCase();
  const password = req.body.password?.trim();

  if (!name || !email || !password) {
    return res
      .status(400)
      .json({ message: "Name, email, and password are required." });
  }

  const createdAt = new Date().toISOString();
  db.run(
    `INSERT INTO students (name, email, password, created_at) VALUES (?, ?, ?, ?)`,
    [name, email, password, createdAt],
    function (err) {
      if (err) {
        if (err.message.includes("UNIQUE constraint failed")) {
          return res
            .status(409)
            .json({ message: "A student with this email already exists." });
        }
        return res.status(500).json({ message: "Could not register student." });
      }
      res.json({ id: this.lastID, name, email });
    },
  );
});

app.post("/login", (req, res) => {
  const email = req.body.email?.trim().toLowerCase();
  const password = req.body.password?.trim();
  if (!email || !password) {
    return res
      .status(400)
      .json({ message: "Email and password are required." });
  }

  db.get(
    `SELECT id, name, email FROM students WHERE lower(email) = ? AND password = ?`,
    [email, password],
    (err, student) => {
      if (err) return res.status(500).json({ message: "Login failed." });
      if (!student)
        return res.status(401).json({ message: "Invalid credentials." });
      res.json(student);
    },
  );
});

app.post("/admin-login", (req, res) => {
  const username = req.body.username?.trim();
  const password = req.body.password?.trim();
  if (username === "admin" && password === "admin") {
    return res.json({ username: "admin" });
  }
  return res.status(401).json({ message: "Invalid admin credentials." });
});

app.post(
  "/submit",
  upload.fields([
    { name: "profile_image", maxCount: 1 },
    { name: "project_image", maxCount: 1 },
  ]),
  (req, res) => {
    const { student_id, project_name, github_link, deploy_link } = req.body;
    const profileImage = req.files.profile_image?.[0]?.filename || null;
    const projectImage = req.files.project_image?.[0]?.filename || null;

    if (!student_id || !project_name || !github_link || !deploy_link) {
      return res.status(400).json({
        message:
          "student_id, project_name, github_link, and deploy_link are required.",
      });
    }

    db.run(
      `UPDATE students SET project_name = ?, github_link = ?, deploy_link = ?, profile_image = ?, project_image = ?, status = 'Pending' WHERE id = ?`,
      [
        project_name,
        github_link,
        deploy_link,
        profileImage,
        projectImage,
        student_id,
      ],
      function (err) {
        if (err)
          return res.status(500).json({ message: "Could not submit project." });
        if (this.changes === 0)
          return res.status(404).json({ message: "Student not found." });
        res.json({ message: "Project submitted successfully." });
      },
    );
  },
);

app.get("/students", (req, res) => {
  const search = req.query.search || "";
  const page = parseInt(req.query.page, 10) || 1;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 5, 1), 20);
  const offset = (page - 1) * limit;
  const searchTerm = `%${search}%`;

  db.all(
    `SELECT id, name, email, project_name, github_link, deploy_link, profile_image, project_image, ui_marks, code_marks, completion_marks, feedback, status, created_at FROM students WHERE name LIKE ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [searchTerm, limit, offset],
    (err, rows) => {
      if (err)
        return res.status(500).json({ message: "Could not fetch students." });

      db.get(
        `SELECT COUNT(*) as count FROM students WHERE name LIKE ?`,
        [searchTerm],
        (countErr, countRow) => {
          if (countErr)
            return res
              .status(500)
              .json({ message: "Could not count students." });
          res.json({ students: rows, total: countRow.count, page, limit });
        },
      );
    },
  );
});

app.get("/student/:id", (req, res) => {
  const { id } = req.params;
  db.get(
    `SELECT id, name, email, project_name, github_link, deploy_link, profile_image, project_image, ui_marks, code_marks, completion_marks, feedback, status FROM students WHERE id = ?`,
    [id],
    (err, student) => {
      if (err)
        return res
          .status(500)
          .json({ message: "Could not fetch student data." });
      if (!student)
        return res.status(404).json({ message: "Student not found." });
      res.json(student);
    },
  );
});

app.get("/student-metrics/:id", (req, res) => {
  const { id } = req.params;
  const studentId = Number(id);

  db.get(
    `SELECT id, status, ui_marks, code_marks, completion_marks FROM students WHERE id = ?`,
    [studentId],
    (err, student) => {
      if (err)
        return res
          .status(500)
          .json({ message: "Could not fetch student metrics." });
      if (!student)
        return res.status(404).json({ message: "Student not found." });

      db.get(`SELECT COUNT(*) as total FROM students`, (countErr, totalRow) => {
        if (countErr)
          return res.status(500).json({ message: "Could not fetch metrics." });

        db.get(
          `SELECT COUNT(*) as reviewed FROM students WHERE status = 'Reviewed'`,
          (reviewErr, reviewedRow) => {
            if (reviewErr)
              return res
                .status(500)
                .json({ message: "Could not fetch metrics." });

            const totalStudents = totalRow?.total ?? 0;
            const totalReviewed = reviewedRow?.reviewed ?? 0;
            const baseResponse = {
              total_students: totalStudents,
              total_reviewed: totalReviewed,
              rank: null,
              percentile: null,
              average_score: null,
            };

            if (String(student.status).trim().toLowerCase() !== "reviewed") {
              return res.json(baseResponse);
            }

            db.all(
              `SELECT id, ui_marks, code_marks, completion_marks FROM students WHERE lower(trim(status)) = 'reviewed'`,
              (rankErr, rows) => {
                if (rankErr)
                  return res
                    .status(500)
                    .json({ message: "Could not compute ranking." });

                const reviewedScores = rows
                  .map((row) => ({
                    id: row.id,
                    avg:
                      ((row.ui_marks || 0) +
                        (row.code_marks || 0) +
                        (row.completion_marks || 0)) /
                      3,
                  }))
                  .sort((a, b) => b.avg - a.avg);

                const rank =
                  reviewedScores.findIndex((row) => row.id === studentId) + 1;
                const average_score =
                  ((student.ui_marks || 0) +
                    (student.code_marks || 0) +
                    (student.completion_marks || 0)) /
                  3;
                const percentile =
                  totalReviewed > 0
                    ? Math.round((1 - (rank - 1) / totalReviewed) * 100)
                    : 100;

                res.json({
                  ...baseResponse,
                  rank,
                  percentile,
                  average_score,
                });
              },
            );
          },
        );
      });
    },
  );
});

app.put("/review/:id", (req, res) => {
  const { id } = req.params;
  const { ui_marks, code_marks, completion_marks, feedback } = req.body;

  if (
    ui_marks == null ||
    code_marks == null ||
    completion_marks == null ||
    feedback == null
  ) {
    return res.status(400).json({
      message:
        "ui_marks, code_marks, completion_marks, and feedback are required.",
    });
  }

  db.run(
    `UPDATE students SET ui_marks = ?, code_marks = ?, completion_marks = ?, feedback = ?, status = 'Reviewed' WHERE id = ?`,
    [ui_marks, code_marks, completion_marks, feedback, id],
    function (err) {
      if (err)
        return res.status(500).json({ message: "Could not submit review." });
      if (this.changes === 0)
        return res.status(404).json({ message: "Student not found." });
      res.json({ message: "Review saved successfully." });
    },
  );
});

app.get("/metrics", (req, res) => {
  db.all(
    `SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN status = 'Reviewed' THEN 1 ELSE 0 END) as reviewed,
      ROUND(AVG(CASE WHEN status = 'Reviewed' AND ui_marks IS NOT NULL THEN CAST(ui_marks AS REAL) ELSE NULL END), 1) as avg_ui,
      ROUND(AVG(CASE WHEN status = 'Reviewed' AND code_marks IS NOT NULL THEN CAST(code_marks AS REAL) ELSE NULL END), 1) as avg_code,
      ROUND(AVG(CASE WHEN status = 'Reviewed' AND completion_marks IS NOT NULL THEN CAST(completion_marks AS REAL) ELSE NULL END), 1) as avg_completion
    FROM students`,
    (err, rows) => {
      if (err) {
        return res.status(500).json({ message: "Could not fetch metrics." });
      }

      const result = rows[0] || {};
      res.json({
        total_students: result.total || 0,
        total_reviewed: result.reviewed || 0,
        average_ui: result.avg_ui !== null ? result.avg_ui : 0,
        average_code: result.avg_code !== null ? result.avg_code : 0,
        average_completion:
          result.avg_completion !== null ? result.avg_completion : 0,
      });
    },
  );
});

app.listen(PORT, () => {
  console.log(`Server listening at http://localhost:${PORT}`);
});
