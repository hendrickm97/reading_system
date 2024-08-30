import express, { Express, Request, Response } from "express";
import dotenv from "dotenv";
import cors from "cors";
import fs from "fs";
import multer from "multer";
import bodyParser from "body-parser";
import { GoogleGenerativeAI } from "@google/generative-ai";
import pool from "./db";
import path from "path";
import { v4 as uuidv4 } from "uuid";

dotenv.config();

const app: Express = express();
const port = process.env.Port || 3000;

app.use(cors());
app.use(bodyParser.json());

const genAI = new GoogleGenerativeAI(process.env.API_KEY!);

const geminiModel = genAI.getGenerativeModel({
  model: "gemini-1.5-flash",
});

const storage = multer.diskStorage({
  destination(req, file, callback) {
    if (!fs.existsSync("./uploads")) {
      fs.mkdirSync("./uploads");
    }
    callback(null, "./uploads");
  },
  filename(req, file, callback) {
    callback(
      null,
      file.fieldname + "_" + Date.now() + path.extname(file.originalname)
    );
  },
});

const upload = multer({ storage: storage });

const measure_uuid = uuidv4();

function imageToBase64(imagePath: string): string | undefined {
  try {
    const absolutePath = path.resolve(__dirname, imagePath);

    if (!fs.existsSync(absolutePath)) {
      console.error(`Arquivo não encontrado: ${absolutePath}`);
      return undefined;
    }

    const imageBuffer = fs.readFileSync(absolutePath);
    const base64Image = imageBuffer.toString("base64");
    return base64Image;
  } catch (error) {
    console.error("Erro ao converter imagem para base64:", error);
    return undefined;
  }
}

app.get("/", async (req, res) => {
  res.send("Hello World");
});

app.post("/upload", upload.single("image"), async (req, res) => {
  const filePath = req.file!.path;
  const image64 = imageToBase64(filePath);

  const measure_tp: "WATER" | "GAS" = req.body;
  const measure_type = measure_tp.toUpperCase;
  const measure_datetime = new Date();
  const { costumer_code } = req.body;

  const prompt = `Quero que faça uma ánalise dessa foto e me diga o valor numérico do medidor de ${measure_type} `;

  const request = await geminiModel.generateContent([
    prompt,
    `data:image/jpeg;base64,${image64}`,
  ]);
  const response = await request.response;
  const measure_value = response.text();

  const existing_read = await pool.query(
    "SELECT * FROM leituras WHERE measure_type = $1 AND measure_datetime = $2",
    [measure_type, measure_datetime]
  );
  if (existing_read) {
    return res
      .status(409)
      .json({ error: `Já existe uma leitura de ${measure_type} no mês` });
  }

  try {
    await pool.query(
      "INSERT INTO leituras (id, image, measure_type, measure_datetime, costumer_code, measure_value) VALUES ($1, $2, $3, $4, $5, $6)",
      [
        measure_uuid,
        image64,
        measure_type,
        measure_datetime,
        costumer_code,
        measure_value,
      ]
    );
    res.status(200).send({
      image_url: `https://localhost/${image64}`,
      measure_value: measure_value,
      measure_uuid: measure_uuid,
    });
  } catch (err) {
    res.send(err);
  }
});

app.patch("/confirm", async (req, res) => {
  const { measure_uuid, confirmed_value } = req.body;

  if (!measure_uuid || typeof confirmed_value !== "number") {
    return res.status(400).json({ error: "Dados inválidos" });
  }

  try {
    const measure = await pool.query(
      "SELECT * FROM leituras WHERE measure_uuid = $1 AND measure_value = $2 ",
      [measure_uuid, confirmed_value]
    );

    if (!measure) {
      return res.status(404).json({ error: "Medida não encontrada" });
    }

    if (measure) {
      return res.status(409).json({ error: "Medida já confirmada" });
    }

    await pool.query("UPDATE leituras SET measure_value WHERE id = $1", [
      confirmed_value,
    ]);

    res.status(200).json({ message: "Valor confirmado com sucesso" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erro ao confirmar valor" });
  }
});

app.get("/list:costumer_code", async (req, res) => {
  const costumer_code = req.body;
  try {
    const list = await pool.query(
      "SELECT * FROM leituras WHERE costumer_code = $1",
      [costumer_code]
    );
    res.send(list);
  } catch (error) {
    console.error(error);
    res
      .status(404)
      .json({
        error: "Esse código do consumidor não existe em nosso bancos de dados",
      });
  }
});

app.listen(port, () => {
  console.log(`[server]: Servidor está rodando no http://localhost:${port}`);
});
