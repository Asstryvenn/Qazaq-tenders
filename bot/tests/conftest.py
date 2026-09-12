import sys
from pathlib import Path

# Модули бота лежат плоско в bot/ — делаем их импортируемыми из тестов
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
