FROM python:3.13.18-slim

# Don't write .pyc files (the filesystem is read-only) and flush logs immediately.
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir --disable-pip-version-check -r requirements.txt
COPY main.py .

# Run as an unprivileged user, not root.
USER 10001
CMD ["python", "main.py"]
