require("dotenv").config();

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { MongoClient, ObjectId } = require("mongodb");

const app = express();
const PORT = process.env.PORT || 4000;
const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/student_portfolio";
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || "student_portfolio";
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

const mongoClient = new MongoClient(MONGODB_URI);
let studentsCollection;

function normalizeStudent(student) {
  if (!student) {
    return null;
  }

  return {
    id: student._id.toString(),
    name: student.name,
    email: student.email,
    password: student.password,
    project_name: student.project_name ?? null,
    github_link: student.github_link ?? null,
    deploy_link: student.deploy_link ?? null,
    profile_image: student.profile_image ?? null,
    project_image: student.project_image ?? null,
    ui_marks: student.ui_marks ?? null,
    code_marks: student.code_marks ?? null,
    completion_marks: student.completion_marks ?? null,
    feedback: student.feedback ?? null,
    status: student.status ?? "Pending",
    created_at: student.created_at ?? null,
  };
}

function parseObjectId(id) {
  if (!ObjectId.isValid(id)) {
    return null;
  }

  return new ObjectId(id);
}

async function connectDatabase() {
  await mongoClient.connect();
  const db = mongoClient.db(MONGODB_DB_NAME);
  studentsCollection = db.collection("students");

  await studentsCollection.createIndex({ email: 1 }, { unique: true });
  await studentsCollection.createIndex({ created_at: -1 });

  console.log(`Connected to MongoDB database "${MONGODB_DB_NAME}".`);
}

app.post("/register", async (req, res) => {
  try {
    const name = req.body.name?.trim();
    const email = req.body.email?.trim().toLowerCase();
    const password = req.body.password?.trim();

    if (!name || !email || !password) {
      return res
        .status(400)
        .json({ message: "Name, email, and password are required." });
    }

    const createdAt = new Date().toISOString();
    const student = {
      name,
      email,
      password,
      project_name: null,
      github_link: null,
      deploy_link: null,
      profile_image: null,
      project_image: null,
      ui_marks: null,
      code_marks: null,
      completion_marks: null,
      feedback: null,
      status: "Pending",
      created_at: createdAt,
    };

    const result = await studentsCollection.insertOne(student);
    return res.json({ id: result.insertedId.toString(), name, email });
  } catch (error) {
    if (error?.code === 11000) {
      return res
        .status(409)
        .json({ message: "A student with this email already exists." });
    }

    console.error("Register failed:", error);
    return res.status(500).json({ message: "Could not register student." });
  }
});

app.post("/login", async (req, res) => {
  try {
    const email = req.body.email?.trim().toLowerCase();
    const password = req.body.password?.trim();

    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "Email and password are required." });
    }

    const student = await studentsCollection.findOne(
      { email, password },
      { projection: { name: 1, email: 1 } },
    );

    if (!student) {
      return res.status(401).json({ message: "Invalid credentials." });
    }

    return res.json({
      id: student._id.toString(),
      name: student.name,
      email: student.email,
    });
  } catch (error) {
    console.error("Login failed:", error);
    return res.status(500).json({ message: "Login failed." });
  }
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
  async (req, res) => {
    try {
      const { student_id, project_name, github_link, deploy_link } = req.body;
      const studentObjectId = parseObjectId(student_id);

      if (!student_id || !project_name || !github_link || !deploy_link) {
        return res.status(400).json({
          message:
            "student_id, project_name, github_link, and deploy_link are required.",
        });
      }

      if (!studentObjectId) {
        return res.status(400).json({ message: "Invalid student id." });
      }

      const update = {
        project_name,
        github_link,
        deploy_link,
        status: "Pending",
      };

      const profileImage = req.files.profile_image?.[0]?.filename || null;
      const projectImage = req.files.project_image?.[0]?.filename || null;

      if (profileImage) {
        update.profile_image = profileImage;
      }

      if (projectImage) {
        update.project_image = projectImage;
      }

      const result = await studentsCollection.updateOne(
        { _id: studentObjectId },
        { $set: update },
      );

      if (result.matchedCount === 0) {
        return res.status(404).json({ message: "Student not found." });
      }

      return res.json({ message: "Project submitted successfully." });
    } catch (error) {
      console.error("Submit failed:", error);
      return res.status(500).json({ message: "Could not submit project." });
    }
  },
);

app.get("/students", async (req, res) => {
  try {
    const search = String(req.query.search || "").trim();
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 5, 1), 20);
    const skip = (page - 1) * limit;
    const query = search
      ? { name: { $regex: search, $options: "i" } }
      : {};

    const [students, total] = await Promise.all([
      studentsCollection
        .find(query, {
          projection: {
            name: 1,
            email: 1,
            project_name: 1,
            github_link: 1,
            deploy_link: 1,
            profile_image: 1,
            project_image: 1,
            ui_marks: 1,
            code_marks: 1,
            completion_marks: 1,
            feedback: 1,
            status: 1,
            created_at: 1,
          },
        })
        .sort({ created_at: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .toArray(),
      studentsCollection.countDocuments(query),
    ]);

    return res.json({
      students: students.map((student) => {
        const normalized = normalizeStudent(student);
        delete normalized.password;
        return normalized;
      }),
      total,
      page,
      limit,
    });
  } catch (error) {
    console.error("Fetch students failed:", error);
    return res.status(500).json({ message: "Could not fetch students." });
  }
});

app.get("/student/:id", async (req, res) => {
  try {
    const studentObjectId = parseObjectId(req.params.id);

    if (!studentObjectId) {
      return res.status(400).json({ message: "Invalid student id." });
    }

    const student = await studentsCollection.findOne(
      { _id: studentObjectId },
      {
        projection: {
          name: 1,
          email: 1,
          project_name: 1,
          github_link: 1,
          deploy_link: 1,
          profile_image: 1,
          project_image: 1,
          ui_marks: 1,
          code_marks: 1,
          completion_marks: 1,
          feedback: 1,
          status: 1,
        },
      },
    );

    if (!student) {
      return res.status(404).json({ message: "Student not found." });
    }

    const normalized = normalizeStudent(student);
    delete normalized.password;
    delete normalized.created_at;
    return res.json(normalized);
  } catch (error) {
    console.error("Fetch student failed:", error);
    return res.status(500).json({ message: "Could not fetch student data." });
  }
});

app.get("/student-metrics/:id", async (req, res) => {
  try {
    const studentObjectId = parseObjectId(req.params.id);

    if (!studentObjectId) {
      return res.status(400).json({ message: "Invalid student id." });
    }

    const student = await studentsCollection.findOne(
      { _id: studentObjectId },
      {
        projection: {
          status: 1,
          ui_marks: 1,
          code_marks: 1,
          completion_marks: 1,
        },
      },
    );

    if (!student) {
      return res.status(404).json({ message: "Student not found." });
    }

    const [totalStudents, totalReviewed] = await Promise.all([
      studentsCollection.countDocuments({}),
      studentsCollection.countDocuments({ status: "Reviewed" }),
    ]);

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

    const reviewedStudents = await studentsCollection
      .find(
        { status: "Reviewed" },
        {
          projection: {
            ui_marks: 1,
            code_marks: 1,
            completion_marks: 1,
          },
        },
      )
      .toArray();

    const reviewedScores = reviewedStudents
      .map((row) => ({
        id: row._id.toString(),
        avg:
          ((row.ui_marks || 0) +
            (row.code_marks || 0) +
            (row.completion_marks || 0)) /
          3,
      }))
      .sort((a, b) => b.avg - a.avg);

    const studentId = studentObjectId.toString();
    const rank = reviewedScores.findIndex((row) => row.id === studentId) + 1;
    const average_score =
      ((student.ui_marks || 0) +
        (student.code_marks || 0) +
        (student.completion_marks || 0)) /
      3;
    const percentile =
      totalReviewed > 0
        ? Math.round((1 - (rank - 1) / totalReviewed) * 100)
        : 100;

    return res.json({
      ...baseResponse,
      rank,
      percentile,
      average_score,
    });
  } catch (error) {
    console.error("Fetch student metrics failed:", error);
    return res.status(500).json({ message: "Could not fetch student metrics." });
  }
});

app.put("/review/:id", async (req, res) => {
  try {
    const studentObjectId = parseObjectId(req.params.id);
    const { ui_marks, code_marks, completion_marks, feedback } = req.body;

    if (!studentObjectId) {
      return res.status(400).json({ message: "Invalid student id." });
    }

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

    const result = await studentsCollection.updateOne(
      { _id: studentObjectId },
      {
        $set: {
          ui_marks: Number(ui_marks),
          code_marks: Number(code_marks),
          completion_marks: Number(completion_marks),
          feedback,
          status: "Reviewed",
        },
      },
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: "Student not found." });
    }

    return res.json({ message: "Review saved successfully." });
  } catch (error) {
    console.error("Review failed:", error);
    return res.status(500).json({ message: "Could not submit review." });
  }
});

app.get("/metrics", async (req, res) => {
  try {
    const [summary] = await studentsCollection
      .aggregate([
        {
          $facet: {
            totals: [
              {
                $group: {
                  _id: null,
                  total_students: { $sum: 1 },
                  total_reviewed: {
                    $sum: {
                      $cond: [{ $eq: ["$status", "Reviewed"] }, 1, 0],
                    },
                  },
                },
              },
            ],
            reviewedAverages: [
              { $match: { status: "Reviewed" } },
              {
                $group: {
                  _id: null,
                  average_ui: { $avg: "$ui_marks" },
                  average_code: { $avg: "$code_marks" },
                  average_completion: { $avg: "$completion_marks" },
                },
              },
            ],
          },
        },
      ])
      .toArray();

    const totals = summary?.totals?.[0] || {};
    const averages = summary?.reviewedAverages?.[0] || {};

    return res.json({
      total_students: totals.total_students || 0,
      total_reviewed: totals.total_reviewed || 0,
      average_ui:
        averages.average_ui != null
          ? Number(averages.average_ui.toFixed(1))
          : 0,
      average_code:
        averages.average_code != null
          ? Number(averages.average_code.toFixed(1))
          : 0,
      average_completion:
        averages.average_completion != null
          ? Number(averages.average_completion.toFixed(1))
          : 0,
    });
  } catch (error) {
    console.error("Fetch metrics failed:", error);
    return res.status(500).json({ message: "Could not fetch metrics." });
  }
});

async function startServer() {
  try {
    await connectDatabase();
    app.listen(PORT, () => {
      console.log(`Server listening at http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Startup failed:", error);
    process.exit(1);
  }
}

startServer();
