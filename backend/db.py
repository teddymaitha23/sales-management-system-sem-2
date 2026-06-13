import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), 'sales_management.db')
SCHEMA_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'database', 'schema.sql'))

def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    # Enable foreign keys and dict-like row access
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.row_factory = sqlite3.Row
    return conn

def initialize_database():
    print(f"Connecting to database at: {DB_PATH}")
    if not os.path.exists(SCHEMA_PATH):
        print(f"Error: Schema file not found at {SCHEMA_PATH}")
        return

    with open(SCHEMA_PATH, 'r', encoding='utf-8') as f:
        schema_sql = f.read()

    conn = get_db_connection()
    try:
        conn.executescript(schema_sql)
        conn.commit()
        print("Database tables initialized successfully.")
    except Exception as e:
        print(f"Error initializing database tables: {e}")
    finally:
        conn.close()

if __name__ == '__main__':
    initialize_database()
