import os
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import numpy as np
import uvicorn
from io import BytesIO
from PIL import Image
import tensorflow as tf
from threading import Lock

load_dotenv()

app=FastAPI(title="AgriAgent | OGK")

origins=[
    "http://localhost",
    "http://localhost:3000",
    "http://127.0.0.1",
    "http://127.0.0.1:3000",
    os.getenv("FRONTEND_ORIGIN", ""),
]
origins = [origin for origin in origins if origin]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MODEL_PATH = Path(
    os.getenv(
        "TOMATO_MODEL_PATH",
        str(Path(__file__).resolve().parent.parent / "models" / "mobileNetV3Large.keras"),
    )
)
MODEL = None
MODEL_LOCK = Lock()


CLASS_NAMES=['Tomato_Bacterial_spot',
 'Tomato_Early_blight',
 'Tomato_Late_blight',
 'Tomato_Leaf_Mold',
 'Tomato_Septoria_leaf_spot',
 'Tomato_Spider_mites_Two_spotted_spider_mite',
 'Tomato__Target_Spot',
 'Tomato__Tomato_YellowLeaf__Curl_Virus',
 'Tomato__Tomato_mosaic_virus',
 'Tomato_healthy']


@app.get("/ping")
async def ping():
    return "Hello im alive"

def read_file_as_image(data)->np.ndarray:
    image=np.array(Image.open(BytesIO(data)))
    return image

def get_model():
    global MODEL
    if MODEL is None:
        if not MODEL_PATH.is_file():
            raise HTTPException(
                status_code=503,
                detail="Tomato classifier model is not configured.",
            )
        with MODEL_LOCK:
            if MODEL is None:
                MODEL = tf.keras.models.load_model(MODEL_PATH)
    return MODEL

@app.post("/predict")
async def predict(
    file:UploadFile=File(...)

):
    model = get_model()
    image=read_file_as_image(await file.read())
    img_batch=np.expand_dims(image,0)

    predictions=model.predict(img_batch)

    predicted_class=CLASS_NAMES[np.argmax(predictions[0])]
    confidence=np.max(predictions[0])
    return {
        "class":predicted_class,
        "confidence":float(confidence)
    }

from agriagent_api import router as agriagent_router

app.include_router(agriagent_router)

frontend_build = Path(__file__).resolve().parent.parent / "frontend" / "build"
if frontend_build.exists():
    from fastapi.staticfiles import StaticFiles

    app.mount("/", StaticFiles(directory=frontend_build, html=True), name="frontend")


if __name__=="__main__":
    uvicorn.run(app,host='0.0.0.0',port=int(os.getenv("PORT", "8000")))