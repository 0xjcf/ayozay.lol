import express from "express";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Server } from "socket.io";
import sqlite3 from "sqlite3";
import { promisify } from "node:util";
import cookieParser from "cookie-parser";
import { v4 as uuidv4 } from "uuid";

const db = new sqlite3.Database(":memory:", (error) => {
  if (error) {
    return console.error(
      "Failed to connect to SQLite database:",
      error.message
    );
  }
  console.log("Connected to the in-memory SQLite database.");
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cookieParser());

const server = createServer(app);
const io = new Server(server, {
  connectionStateRecovery: {},
});

const closeDb = promisify(db.close.bind(db));
const closeServer = promisify(server.close.bind(server));

const logVisitors = () => {
  db.each("SELECT * FROM visitors", (error, row) => {
    if (error) {
      return console.error("Failed to fetch visitors:", error.message);
    }
    console.log(row);
  });
};

const shutdownServer = async () => {
  console.log("\nShutting down gracefully...");
  try {
    io.close((error) => {
      if (error) {
        return console.error("Failed to close Socket.IO:", error.message);
      }
      console.log("Closed the socket connection.");
    });

    if (server.listening) {
      await closeServer();
      console.log("Closed the server connection.");
    } else {
      console.log("Server is already closed.");
    }

    await closeDb();
    console.log("Closed the database connection.");
  } catch (error) {
    console.error(
      "Error during shutdown:",
      error instanceof Error ? error.message : error
    );
  } finally {
    process.exit(0);
  }
};

process.on("SIGINT", shutdownServer);

app.get("/", (request, response) => {
  if (!request.cookies.userId) {
    const newUserId = uuidv4();
    response.cookie("userId", newUserId);
  }
  response.sendFile(join(__dirname, "index.html"));
});

db.serialize(() => {
  db.run(
    `CREATE TABLE visitors(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId TEXT,
      sessionId TEXT,
      count INTEGER, 
      time TEXT
    )`
  );
});

io.on("connection", (socket) => {
  const cookieUserId =
    socket.handshake.headers.cookie?.match(/userId=([^;]+)/)?.[1];
  const sessionId = uuidv4();
  const numberOfVistors = io.engine.clientsCount;

  let clientId = 0;

  if (cookieUserId) {
    db.run(
      `INSERT INTO visitors(userId, sessionId, count, time) VALUES(?, ?, ?, datetime('now'))`,
      [cookieUserId, sessionId, numberOfVistors],
      function () {
        clientId = this.lastID;
        console.log(
          `A user connected with clientId: ${clientId} (userId: ${cookieUserId}, sessionId: ${sessionId})`
        );
        logVisitors();
      }
    );
  }

  socket.on("disconnect", () => {
    db.run("DELETE FROM visitors WHERE sessionId = ?", [sessionId], (error) => {
      if (error) {
        return console.error(
          "Failed to remove session with sessionId:",
          sessionId,
          error.message
        );
      }
      console.log(
        `Removed session with sessionId: ${sessionId} (clientId: ${clientId})`
      );
      logVisitors();
    });
    console.log("User disconnected");
  });

  socket.on("client chat message", (message) => {
    console.log(
      `Message from session ${sessionId} (clientId: ${clientId}):`,
      message
    );
    io.emit("server chat message", message);
  });
});

server.listen(8080, () => {
  console.log("Server is running on http://localhost:8080");
});
