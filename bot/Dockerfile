FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .
# SQLite хранится в томе, чтобы профили переживали перезапуск контейнера
VOLUME ["/app/data"]

# По умолчанию polling. Для webhook: CMD ["uvicorn", "api:app", "--host", "0.0.0.0", "--port", "8080"]
CMD ["python", "bot.py"]
