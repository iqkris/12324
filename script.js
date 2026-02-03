const firebaseConfig = {
  apiKey: "REPLACE_ME",
  authDomain: "REPLACE_ME",
  projectId: "REPLACE_ME",
  storageBucket: "REPLACE_ME",
  messagingSenderId: "REPLACE_ME",
  appId: "REPLACE_ME",
};

const configMissing = Object.values(firebaseConfig).some(
  (value) => value === "REPLACE_ME"
);
const app = configMissing ? null : firebase.initializeApp(firebaseConfig);
const db = app ? firebase.firestore() : null;

const noteTemplate = document.querySelector("#noteTemplate");
const notesContainer = document.querySelector("#notes");
const statusBox = document.querySelector("#status");
const publishButton = document.querySelector("#publish");
const saveLocalButton = document.querySelector("#saveLocal");
const copyGuideButton = document.querySelector("#copyGuide");
const clearCanvasButton = document.querySelector("#clearCanvas");
const filterButtons = document.querySelectorAll(".chip");
const pinToggle = document.querySelector("#pinToggle");

const titleInput = document.querySelector("#title");
const authorInput = document.querySelector("#author");
const messageInput = document.querySelector("#message");
const imageInput = document.querySelector("#image");

const canvas = document.querySelector("#canvas");
const colorInput = document.querySelector("#color");
const sizeInput = document.querySelector("#size");
const ctx = canvas.getContext("2d");

let drawing = false;
let lastPoint = null;
let currentFilter = "all";
let notesCache = [];
const localKey = "shared-notebook";
const currentUser = localStorage.getItem("notebook-user") || crypto.randomUUID();
localStorage.setItem("notebook-user", currentUser);

const guideText = `
1. Откройте console.firebase.google.com и создайте проект.
2. Включите Cloud Firestore (режим test).
3. Скопируйте конфиг Web-приложения.
4. Вставьте значения в firebaseConfig в script.js.
5. Обновите страницу — записи будут общими для всех.
`;

const setStatus = (text, type = "") => {
  statusBox.textContent = text;
  statusBox.className = `status ${type}`.trim();
};

const resizeCanvas = () => {
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = colorInput.value;
  ctx.lineWidth = sizeInput.value;
};

const startDraw = (event) => {
  drawing = true;
  lastPoint = getPoint(event);
};

const draw = (event) => {
  if (!drawing) return;
  const point = getPoint(event);
  ctx.strokeStyle = colorInput.value;
  ctx.lineWidth = sizeInput.value;
  ctx.beginPath();
  ctx.moveTo(lastPoint.x, lastPoint.y);
  ctx.lineTo(point.x, point.y);
  ctx.stroke();
  lastPoint = point;
};

const stopDraw = () => {
  drawing = false;
  lastPoint = null;
};

const getPoint = (event) => {
  const rect = canvas.getBoundingClientRect();
  const point = event.touches ? event.touches[0] : event;
  return {
    x: point.clientX - rect.left,
    y: point.clientY - rect.top,
  };
};

const clearCanvas = () => {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
};

const renderNotes = (notes) => {
  notesCache = notes;
  notesContainer.innerHTML = "";
  const filtered = notes.filter((note) => {
    if (currentFilter === "pinned") return note.pinned;
    if (currentFilter === "mine") return note.authorId === currentUser;
    return true;
  });

  if (!filtered.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "Записей пока нет. Создайте первую!";
    notesContainer.appendChild(empty);
    return;
  }

  filtered.forEach((note) => {
    const node = noteTemplate.content.cloneNode(true);
    const article = node.querySelector(".note");
    const title = node.querySelector(".note-title");
    const meta = node.querySelector(".note-meta");
    const text = node.querySelector(".note-text");
    const image = node.querySelector(".note-image");
    const drawingImage = node.querySelector(".note-drawing");
    const copyButton = node.querySelector(".note-copy");

    article.classList.toggle("pinned", note.pinned);
    title.textContent = note.title || "Без названия";
    meta.textContent = `${note.author || "Аноним"} · ${new Date(
      note.createdAt
    ).toLocaleString("ru-RU")}`;
    text.textContent = note.message;

    if (note.image) {
      image.src = note.image;
      image.classList.remove("hidden");
    } else {
      image.classList.add("hidden");
    }

    if (note.drawing) {
      drawingImage.src = note.drawing;
      drawingImage.classList.remove("hidden");
    } else {
      drawingImage.classList.add("hidden");
    }

    copyButton.addEventListener("click", async () => {
      await navigator.clipboard.writeText(note.message);
      setStatus("Текст скопирован в буфер обмена.");
    });

    notesContainer.appendChild(node);
  });
};

const readLocalNotes = () => {
  const stored = localStorage.getItem(localKey);
  return stored ? JSON.parse(stored) : [];
};

const saveLocalNotes = (notes) => {
  localStorage.setItem(localKey, JSON.stringify(notes));
};

const saveNote = async ({
  title,
  author,
  message,
  image,
  drawing,
  pinned,
  authorId,
}) => {
  const note = {
    title,
    author,
    message,
    image,
    drawing,
    pinned,
    authorId,
    createdAt: new Date().toISOString(),
  };

  if (!db) {
    const localNotes = readLocalNotes();
    localNotes.unshift(note);
    saveLocalNotes(localNotes);
    setStatus("Запись сохранена локально.", "warning");
    return;
  }

  try {
    await db.collection("notes").add(note);
    setStatus("Запись опубликована!", "success");
  } catch (error) {
    const localNotes = readLocalNotes();
    localNotes.unshift(note);
    saveLocalNotes(localNotes);
    setStatus(
      "Не удалось сохранить в облаке. Запись сохранена локально.",
      "warning"
    );
  }
};

const publish = async () => {
  const title = titleInput.value.trim();
  const author = authorInput.value.trim();
  const message = messageInput.value.trim();

  if (!message) {
    setStatus("Добавьте текст записи перед публикацией.", "warning");
    return;
  }

  const imageFile = imageInput.files[0];
  const image = imageFile ? await fileToDataUrl(imageFile) : "";
  const drawing = canvasHasDrawing() ? canvas.toDataURL("image/png") : "";

  await saveNote({
    title,
    author,
    message,
    image,
    drawing,
    pinned: pinToggle.checked,
    authorId: currentUser,
  });

  clearForm();
};

const clearForm = () => {
  titleInput.value = "";
  messageInput.value = "";
  imageInput.value = "";
  pinToggle.checked = false;
  clearCanvas();
};

const fileToDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("File read error"));
    reader.readAsDataURL(file);
  });

const canvasHasDrawing = () => {
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return data.some((channel) => channel !== 0);
};

const loadNotes = () => {
  if (!db) {
    renderNotes(readLocalNotes());
    setStatus(
      "Облачная синхронизация не настроена. Используется локальное хранилище.",
      "warning"
    );
    return;
  }

  db.collection("notes")
    .orderBy("createdAt", "desc")
    .onSnapshot(
      (snapshot) => {
        const notes = snapshot.docs.map((doc) => doc.data());
        if (!notes.length) {
          const localNotes = readLocalNotes();
          renderNotes(localNotes);
          return;
        }
        renderNotes(notes);
      },
      () => {
        const localNotes = readLocalNotes();
        renderNotes(localNotes);
        setStatus("Облачная синхронизация недоступна.", "warning");
      }
    );
};

const saveLocalOnly = () => {
  const message = messageInput.value.trim();
  if (!message) {
    setStatus("Добавьте текст записи перед сохранением.", "warning");
    return;
  }

  const localNotes = readLocalNotes();
  const note = {
    title: titleInput.value.trim(),
    author: authorInput.value.trim(),
    message,
    image: "",
    drawing: canvasHasDrawing() ? canvas.toDataURL("image/png") : "",
    pinned: pinToggle.checked,
    authorId: currentUser,
    createdAt: new Date().toISOString(),
  };
  localNotes.unshift(note);
  saveLocalNotes(localNotes);
  renderNotes(localNotes);
  clearForm();
  setStatus("Запись сохранена локально.");
};

const applyFilter = (filter) => {
  currentFilter = filter;
  filterButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.filter === filter);
  });
  renderNotes(notesCache);
};

copyGuideButton.addEventListener("click", async () => {
  await navigator.clipboard.writeText(guideText.trim());
  setStatus("Инструкция скопирована.");
});

publishButton.addEventListener("click", publish);
saveLocalButton.addEventListener("click", saveLocalOnly);
clearCanvasButton.addEventListener("click", clearCanvas);

filterButtons.forEach((button) => {
  button.addEventListener("click", () => applyFilter(button.dataset.filter));
});

["mousedown", "touchstart"].forEach((event) => {
  canvas.addEventListener(event, startDraw);
});
["mousemove", "touchmove"].forEach((event) => {
  canvas.addEventListener(event, draw);
});
["mouseup", "mouseleave", "touchend", "touchcancel"].forEach((event) => {
  canvas.addEventListener(event, stopDraw);
});

window.addEventListener("resize", resizeCanvas);

resizeCanvas();
loadNotes();
renderNotes(readLocalNotes());
