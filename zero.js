#!/usr/bin/env python3
"""
Telegram Bot Panel Legal by Panji
Menjual Panel (1GB-UNLIMITED) dan Script dengan sistem Role (User/Reseller/Admin)
Garansi hanya untuk Panel (1 bulan)
Auto delivery untuk Panel dan Script
Integrasi Pterodactyl Panel API (PTLA/PTLC)
"""

import logging
import sqlite3
import json
import os
import shutil
import zipfile
import hashlib
import random
import string
import re
from datetime import datetime, timedelta
from typing import Dict, List, Optional
import asyncio
import requests

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import Application, CommandHandler, CallbackQueryHandler, MessageHandler, filters, ContextTypes

# ==================== KONFIGURASI ====================
BOT_TOKEN = "8539961801:AAEtCUf9W9HDIg6T1MJlEdeu0RivtkQq5cM"  # Ganti dengan token dari @BotFather
ADMIN_IDS = [8708077152]  # Ganti dengan ID Telegram Anda (cek di @userinfobot)

# Konfigurasi Pterodactyl Panel
PTERODACTYL_CONFIG = {
    "panel_url": "https://panel.panelegal.com",  # URL panel utama
    "ptla": "ptla_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",  # Application API Key (Admin)
    "location_id": 1,
    "node_id": 1,
    "nest_id": 1,
    "egg_id": 1,
}

# Informasi rekening untuk top up
BANK_INFO = {
    "bank": "BCA",
    "nomor": "1234567890",
    "nama": "PT PANEL LEGAL",
}

DB_PATH = "users.db"
SCRIPT_STORAGE_PATH = "scripts_storage"

# Setup logging
logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.INFO
)
logger = logging.getLogger(__name__)

# ==================== DATA PANEL ====================
PANEL_PRODUCTS = {
    "1gb": {
        "name": "Panel 1GB RAM",
        "ram": 1024,
        "user_price": 2000,
        "reseller_price": 1500,
        "description": "Panel dengan RAM 1GB, cocok untuk website kecil",
        "features": ["1GB RAM", "10GB SSD", "1 Core CPU", "1 Database", "SSL Certificate"]
    },
    "3gb": {
        "name": "Panel 3GB RAM",
        "ram": 3072,
        "user_price": 5000,
        "reseller_price": 4500,
        "description": "Panel dengan RAM 3GB, untuk website menengah",
        "features": ["3GB RAM", "30GB SSD", "2 Core CPU", "3 Database", "SSL Certificate", "Backup Harian"]
    },
    "5gb": {
        "name": "Panel 5GB RAM",
        "ram": 5120,
        "user_price": 7000,
        "reseller_price": 6500,
        "description": "Panel dengan RAM 5GB, performa tinggi",
        "features": ["5GB RAM", "50GB SSD", "4 Core CPU", "5 Database", "SSL Certificate", "Backup Harian", "Auto Backup"]
    },
    "8gb": {
        "name": "Panel 8GB RAM",
        "ram": 8192,
        "user_price": 10000,
        "reseller_price": 9500,
        "description": "Panel dengan RAM 8GB, untuk aplikasi berat",
        "features": ["8GB RAM", "80GB SSD", "6 Core CPU", "10 Database", "SSL Certificate", "Backup Harian", "Priority Support"]
    },
    "10gb": {
        "name": "Panel 10GB RAM",
        "ram": 10240,
        "user_price": 12000,
        "reseller_price": 11500,
        "description": "Panel dengan RAM 10GB, performa maksimal",
        "features": ["10GB RAM", "100GB SSD", "8 Core CPU", "15 Database", "SSL Certificate", "Backup Harian", "Priority Support"]
    },
    "unli": {
        "name": "Panel Unlimited RAM",
        "ram": 0,
        "user_price": 13500,
        "reseller_price": 12000,
        "description": "Panel dengan RAM Unlimited, tanpa batasan",
        "features": ["Unlimited RAM", "200GB SSD", "10 Core CPU", "Unlimited Database", "SSL Certificate", "Backup Harian", "Priority Support 24/7", "Dedicated IP"]
    }
}

def get_panel_price(ram_size: str, role: str) -> int:
    panel = PANEL_PRODUCTS.get(ram_size)
    if not panel:
        return 0
    if role == 'reseller':
        return panel['reseller_price']
    elif role == 'admin':
        return 0
    return panel['user_price']

def get_panel_by_ram(ram_size: str) -> dict:
    return PANEL_PRODUCTS.get(ram_size)

# ==================== PTERODACTYL API ====================
class PterodactylAPI:
    def __init__(self, panel_url: str, ptla: str):
        self.panel_url = panel_url.rstrip('/')
        self.ptla = ptla
        self.headers = {
            "Authorization": f"Bearer {ptla}",
            "Content-Type": "application/json",
            "Accept": "application/json"
        }
    
    def create_user(self, email: str, username: str, first_name: str, last_name: str) -> dict:
        password = self._generate_password()
        data = {
            "email": email,
            "username": username,
            "first_name": first_name,
            "last_name": last_name,
            "password": password
        }
        
        try:
            response = requests.post(
                f"{self.panel_url}/api/application/users",
                headers=self.headers,
                json=data,
                timeout=30
            )
            
            if response.status_code in [200, 201]:
                user_data = response.json()
                attributes = user_data.get('attributes', {})
                return {
                    'success': True,
                    'user_id': attributes.get('id'),
                    'email': attributes.get('email'),
                    'username': attributes.get('username'),
                    'password': password,
                    'api_key': self._create_client_api_key(attributes.get('id'))
                }
            return {'success': False, 'error': response.text}
        except Exception as e:
            return {'success': False, 'error': str(e)}
    
    def _create_client_api_key(self, user_id: int) -> str:
        data = {"description": "Generated by Panel Legal Bot", "allowed_ips": ["*"]}
        try:
            response = requests.post(
                f"{self.panel_url}/api/application/users/{user_id}/api-keys",
                headers=self.headers,
                json=data,
                timeout=30
            )
            if response.status_code in [200, 201]:
                key_data = response.json()
                return key_data.get('attributes', {}).get('key', '')
            return hashlib.sha256(f"{user_id}{datetime.now()}".encode()).hexdigest()
        except Exception:
            return hashlib.sha256(f"{user_id}{datetime.now()}".encode()).hexdigest()
    
    def create_server(self, user_id: int, server_name: str, ram: int, cpu: int = 100, disk: int = 5120) -> dict:
        allocation = self._get_available_allocation()
        if not allocation:
            return {'success': False, 'error': 'No allocation available'}
        
        data = {
            "name": server_name,
            "user": user_id,
            "egg": PTERODACTYL_CONFIG["egg_id"],
            "docker_image": "ghcr.io/pterodactyl/yolks:java_17",
            "startup": "java -Xms128M -Xmx{{SERVER_MEMORY}}M -jar {{SERVER_JARFILE}}",
            "environment": {"SERVER_JARFILE": "server.jar", "VANILLA_VERSION": "latest"},
            "limits": {"memory": ram, "swap": 0, "disk": disk, "io": 500, "cpu": cpu},
            "feature_limits": {"databases": 2, "allocations": 1, "backups": 2},
            "allocation": {"default": allocation['id']},
            "start_on_completion": True
        }
        
        try:
            response = requests.post(
                f"{self.panel_url}/api/application/servers",
                headers=self.headers,
                json=data,
                timeout=60
            )
            if response.status_code in [200, 201]:
                server_data = response.json()
                attributes = server_data.get('attributes', {})
                return {
                    'success': True,
                    'server_id': attributes.get('id'),
                    'server_uuid': attributes.get('uuid'),
                    'server_name': server_name,
                    'allocation': allocation
                }
            return {'success': False, 'error': response.text}
        except Exception as e:
            return {'success': False, 'error': str(e)}
    
    def _get_available_allocation(self) -> dict:
        try:
            response = requests.get(
                f"{self.panel_url}/api/application/nodes/{PTERODACTYL_CONFIG['node_id']}/allocations",
                headers=self.headers,
                timeout=30
            )
            if response.status_code == 200:
                allocations = response.json().get('data', [])
                for alloc in allocations:
                    if not alloc.get('attributes', {}).get('assigned'):
                        return {
                            'id': alloc.get('attributes', {}).get('id'),
                            'ip': alloc.get('attributes', {}).get('ip'),
                            'port': alloc.get('attributes', {}).get('port')
                        }
            return {'id': 1, 'ip': '103.150.92.1', 'port': 25565}
        except Exception:
            return {'id': 1, 'ip': '103.150.92.1', 'port': 25565}
    
    def _generate_password(self, length: int = 12) -> str:
        chars = string.ascii_letters + string.digits + "!@#$%^&*"
        return ''.join(random.choices(chars, k=length))

pterodactyl = PterodactylAPI(PTERODACTYL_CONFIG["panel_url"], PTERODACTYL_CONFIG["ptla"])

# ==================== DATABASE ====================
def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    
    c.execute('''CREATE TABLE IF NOT EXISTS users
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  telegram_id INTEGER UNIQUE,
                  username TEXT,
                  full_name TEXT,
                  role TEXT DEFAULT 'user',
                  balance INTEGER DEFAULT 0,
                  total_spent INTEGER DEFAULT 0,
                  commission_balance INTEGER DEFAULT 0,
                  referrer_id INTEGER,
                  reseller_discount INTEGER DEFAULT 0,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  upgraded_at TIMESTAMP)''')
    
    c.execute('''CREATE TABLE IF NOT EXISTS orders
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  user_id INTEGER,
                  product_type TEXT,
                  product_name TEXT,
                  quantity INTEGER,
                  price INTEGER,
                  status TEXT DEFAULT 'pending',
                  payment_proof TEXT,
                  warranty_id INTEGER,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
    
    c.execute('''CREATE TABLE IF NOT EXISTS transactions
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  user_id INTEGER,
                  type TEXT,
                  amount INTEGER,
                  balance_before INTEGER,
                  balance_after INTEGER,
                  description TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
    
    c.execute('''CREATE TABLE IF NOT EXISTS topup_requests
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  request_code TEXT UNIQUE,
                  user_id INTEGER,
                  amount INTEGER,
                  method TEXT,
                  status TEXT DEFAULT 'pending',
                  payment_proof TEXT,
                  admin_note TEXT,
                  confirmed_by INTEGER,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  confirmed_at TIMESTAMP)''')
    
    c.execute('''CREATE TABLE IF NOT EXISTS topup_history
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  user_id INTEGER,
                  amount INTEGER,
                  status TEXT,
                  confirmed_by INTEGER,
                  confirmed_at TIMESTAMP,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
    
    c.execute('''CREATE TABLE IF NOT EXISTS commissions
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  reseller_id INTEGER,
                  buyer_id INTEGER,
                  order_id INTEGER,
                  amount INTEGER,
                  percentage INTEGER,
                  status TEXT DEFAULT 'pending',
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  paid_at TIMESTAMP)''')
    
    c.execute('''CREATE TABLE IF NOT EXISTS warranties
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  warranty_code TEXT UNIQUE,
                  order_id INTEGER,
                  user_id INTEGER,
                  product_id INTEGER,
                  product_type TEXT,
                  product_name TEXT,
                  server_id TEXT,
                  status TEXT DEFAULT 'active',
                  activated_at TIMESTAMP,
                  expires_at TIMESTAMP,
                  claimed_at TIMESTAMP,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
    
    c.execute('''CREATE TABLE IF NOT EXISTS warranty_claims
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  warranty_id INTEGER,
                  user_id INTEGER,
                  issue_type TEXT,
                  issue_description TEXT,
                  status TEXT DEFAULT 'pending',
                  admin_note TEXT,
                  resolution TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  resolved_at TIMESTAMP)''')
    
    c.execute('''CREATE TABLE IF NOT EXISTS scripts
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  name TEXT UNIQUE,
                  description TEXT,
                  version TEXT,
                  user_price INTEGER,
                  reseller_price INTEGER,
                  category TEXT,
                  file_path TEXT,
                  file_size INTEGER,
                  file_hash TEXT,
                  is_active INTEGER DEFAULT 1,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  updated_at TIMESTAMP)''')
    
    c.execute('''CREATE TABLE IF NOT EXISTS script_licenses
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  script_id INTEGER,
                  license_key TEXT UNIQUE,
                  buyer_id INTEGER,
                  order_id INTEGER,
                  price_paid INTEGER,
                  role TEXT,
                  status TEXT DEFAULT 'active',
                  download_count INTEGER DEFAULT 0,
                  sold_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  activated_at TIMESTAMP,
                  activated_domain TEXT,
                  expires_at TIMESTAMP)''')
    
    c.execute('''CREATE TABLE IF NOT EXISTS script_downloads
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  license_key TEXT,
                  buyer_id INTEGER,
                  download_ip TEXT,
                  downloaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
    
    c.execute('''CREATE TABLE IF NOT EXISTS panel_users
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  user_id INTEGER,
                  pterodactyl_user_id INTEGER,
                  panel_name TEXT,
                  ram_size TEXT,
                  username TEXT,
                  password TEXT,
                  api_key TEXT,
                  server_id TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
    
    conn.commit()
    conn.close()
    logger.info("Database initialized")

# ==================== USER FUNCTIONS ====================
def register_user(telegram_id: int, username: str, full_name: str, referrer_id: int = None) -> dict:
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT * FROM users WHERE telegram_id = ?", (telegram_id,))
    existing = c.fetchone()
    if existing:
        conn.close()
        return {'id': existing[0], 'telegram_id': existing[1], 'role': existing[4], 'balance': existing[5]}
    c.execute("INSERT INTO users (telegram_id, username, full_name, referrer_id) VALUES (?, ?, ?, ?)",
              (telegram_id, username, full_name, referrer_id))
    user_id = c.lastrowid
    conn.commit()
    conn.close()
    return {'id': user_id, 'telegram_id': telegram_id, 'role': 'user', 'balance': 0}

def get_user_role(telegram_id: int) -> str:
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT role FROM users WHERE telegram_id = ?", (telegram_id,))
    result = c.fetchone()
    conn.close()
    return result[0] if result else 'user'

def get_user_stats(telegram_id: int) -> dict:
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT role, balance, total_spent, commission_balance, created_at FROM users WHERE telegram_id = ?", (telegram_id,))
    user = c.fetchone()
    conn.close()
    if not user:
        return {'role': 'user', 'balance': 0, 'total_spent': 0, 'commission_balance': 0}
    stats = {'role': user[0], 'balance': user[1] or 0, 'total_spent': user[2] or 0, 'commission_balance': user[3] or 0, 'joined_at': user[4]}
    if user[0] == 'reseller':
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute("SELECT SUM(amount) FROM commissions WHERE reseller_id = ? AND status = 'pending'", (telegram_id,))
        pending = c.fetchone()[0] or 0
        c.execute("SELECT SUM(amount) FROM commissions WHERE reseller_id = ? AND status = 'paid'", (telegram_id,))
        paid = c.fetchone()[0] or 0
        c.execute("SELECT COUNT(*) FROM users WHERE referrer_id = ?", (telegram_id,))
        downline_count = c.fetchone()[0] or 0
        conn.close()
        stats['pending'] = pending
        stats['paid'] = paid
        stats['total_commission'] = pending + paid
        stats['downline_count'] = downline_count
    return stats

def upgrade_to_reseller(telegram_id: int, upgrade_fee: int = 5000) -> bool:
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT role, balance FROM users WHERE telegram_id = ?", (telegram_id,))
    user = c.fetchone()
    if not user or user[0] != 'user' or user[1] < upgrade_fee:
        conn.close()
        return False
    new_balance = user[1] - upgrade_fee
    c.execute("UPDATE users SET role = 'reseller', balance = ?, reseller_discount = 25, upgraded_at = ? WHERE telegram_id = ?",
              (new_balance, datetime.now(), telegram_id))
    c.execute("INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, description) VALUES (?, 'upgrade', ?, ?, ?, ?)",
              (telegram_id, upgrade_fee, user[1], new_balance, "Upgrade ke Reseller"))
    conn.commit()
    conn.close()
    return True

def deduct_balance(telegram_id: int, amount: int, description: str = "Purchase") -> bool:
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT balance, role FROM users WHERE telegram_id = ?", (telegram_id,))
    result = c.fetchone()
    if not result:
        conn.close()
        return False
    balance, role = result
    if role == 'admin':
        conn.close()
        return True
    if balance < amount:
        conn.close()
        return False
    new_balance = balance - amount
    c.execute("UPDATE users SET balance = ?, total_spent = total_spent + ? WHERE telegram_id = ?", (new_balance, amount, telegram_id))
    c.execute("INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, description) VALUES (?, 'purchase', ?, ?, ?, ?)",
              (telegram_id, amount, balance, new_balance, description))
    conn.commit()
    conn.close()
    return True

def add_commission(reseller_id: int, buyer_id: int, order_id: int, amount: int, percentage: int) -> bool:
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    commission_amount = int(amount * percentage / 100)
    c.execute("INSERT INTO commissions (reseller_id, buyer_id, order_id, amount, percentage, status) VALUES (?, ?, ?, ?, ?, 'pending')",
              (reseller_id, buyer_id, order_id, commission_amount, percentage))
    conn.commit()
    conn.close()
    return True

def add_order(user_id: int, product_type: str, product_name: str, quantity: int, price: int) -> int:
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("INSERT INTO orders (user_id, product_type, product_name, quantity, price, status) VALUES (?, ?, ?, ?, ?, 'pending')",
              (user_id, product_type, product_name, quantity, price))
    order_id = c.lastrowid
    conn.commit()
    conn.close()
    return order_id

def update_order_status(order_id: int, status: str):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("UPDATE orders SET status = ? WHERE id = ?", (status, order_id))
    conn.commit()
    conn.close()

def get_reseller_downline(reseller_id: int) -> List[dict]:
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT telegram_id, username, full_name, total_spent, created_at FROM users WHERE referrer_id = ? ORDER BY created_at DESC", (reseller_id,))
    downlines = c.fetchall()
    conn.close()
    return [{'telegram_id': d[0], 'username': d[1], 'full_name': d[2], 'total_spent': d[3], 'joined_at': d[4]} for d in downlines]

# ==================== TOP UP FUNCTIONS ====================
def generate_topup_code() -> str:
    prefix = "TP"
    random_part = ''.join(random.choices(string.ascii_uppercase + string.digits, k=4))
    number_part = str(random.randint(1000, 9999))
    timestamp_part = datetime.now().strftime("%m%d%H")
    return f"{prefix}-{random_part}-{number_part}-{timestamp_part}"

def create_topup_request(user_id: int, amount: int, method: str = "transfer", payment_proof: str = None) -> dict:
    if amount < 1000:
        return None
    request_code = generate_topup_code()
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("INSERT INTO topup_requests (request_code, user_id, amount, method, payment_proof, status) VALUES (?, ?, ?, ?, ?, 'pending')",
              (request_code, user_id, amount, method, payment_proof))
    request_id = c.lastrowid
    conn.commit()
    conn.close()
    return {'id': request_id, 'code': request_code, 'user_id': user_id, 'amount': amount, 'status': 'pending'}

def confirm_topup(request_code: str, admin_id: int, admin_note: str = None) -> bool:
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT id, user_id, amount, status FROM topup_requests WHERE request_code = ?", (request_code,))
    request = c.fetchone()
    if not request or request[3] != 'pending':
        conn.close()
        return False
    request_id, user_id, amount, _ = request
    c.execute("UPDATE topup_requests SET status = 'confirmed', confirmed_by = ?, confirmed_at = ?, admin_note = ? WHERE request_code = ?",
              (admin_id, datetime.now(), admin_note, request_code))
    c.execute("SELECT balance FROM users WHERE telegram_id = ?", (user_id,))
    user = c.fetchone()
    if user:
        old_balance = user[0]
        new_balance = old_balance + amount
        c.execute("UPDATE users SET balance = ? WHERE telegram_id = ?", (new_balance, user_id))
        c.execute("INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, description) VALUES (?, 'deposit', ?, ?, ?, ?)",
                  (user_id, amount, old_balance, new_balance, f"Top up via {request_code}"))
    c.execute("INSERT INTO topup_history (user_id, amount, status, confirmed_by, confirmed_at) VALUES (?, ?, 'confirmed', ?, ?)",
              (user_id, amount, admin_id, datetime.now()))
    conn.commit()
    conn.close()
    return True

def get_pending_topup_requests() -> List[dict]:
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("""SELECT tr.*, u.username, u.full_name
                 FROM topup_requests tr
                 JOIN users u ON tr.user_id = u.telegram_id
                 WHERE tr.status = 'pending'
                 ORDER BY tr.created_at ASC""")
    requests = c.fetchall()
    conn.close()
    return [{'code': r[1], 'user_id': r[2], 'amount': r[3], 'method': r[4], 'username': r[11], 'full_name': r[12]} for r in requests]

# ==================== WARRANTY FUNCTIONS ====================
def generate_warranty_code(order_id: int, user_id: int, product_name: str) -> str:
    prefix = "WG"
    random_part = ''.join(random.choices(string.ascii_uppercase + string.digits, k=4))
    hash_input = f"{order_id}{user_id}{product_name}{datetime.now().timestamp()}"
    hash_part = hashlib.md5(hash_input.encode()).hexdigest()[:4].upper()
    number_part = str(random.randint(1000, 9999))
    return f"{prefix}-{random_part}-{hash_part}-{number_part}"

def create_warranty(order_id: int, user_id: int, product_id: int, product_type: str, product_name: str, server_id: str = None) -> dict:
    if product_type != 'panel':
        return None
    warranty_code = generate_warranty_code(order_id, user_id, product_name)
    activated_at = datetime.now()
    expires_at = activated_at + timedelta(days=30)
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("INSERT INTO warranties (warranty_code, order_id, user_id, product_id, product_type, product_name, server_id, activated_at, expires_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')",
              (warranty_code, order_id, user_id, product_id, product_type, product_name, server_id, activated_at, expires_at))
    warranty_id = c.lastrowid
    conn.commit()
    conn.close()
    return {'id': warranty_id, 'code': warranty_code, 'activated_at': activated_at, 'expires_at': expires_at}

def get_user_warranties(user_id: int) -> List[dict]:
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT * FROM warranties WHERE user_id = ? AND product_type = 'panel' ORDER BY created_at DESC", (user_id,))
    warranties = c.fetchall()
    conn.close()
    result = []
    for w in warranties:
        days_left = 0
        if w[10]:
            expires_at = datetime.strptime(w[10], '%Y-%m-%d %H:%M:%S')
            days_left = (expires_at - datetime.now()).days
        result.append({'id': w[0], 'code': w[1], 'product_name': w[6], 'status': w[8], 'expires_at': w[10], 'days_left': days_left})
    return result

def claim_warranty(warranty_id: int, user_id: int, issue_type: str, issue_description: str) -> int:
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("INSERT INTO warranty_claims (warranty_id, user_id, issue_type, issue_description, status) VALUES (?, ?, ?, ?, 'pending')",
              (warranty_id, user_id, issue_type, issue_description))
    claim_id = c.lastrowid
    c.execute("UPDATE warranties SET status = 'claimed', claimed_at = ? WHERE id = ?", (datetime.now(), warranty_id))
    conn.commit()
    conn.close()
    return claim_id

def get_pending_claims() -> List[dict]:
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("""SELECT wc.*, w.warranty_code, w.product_name, u.username, u.full_name
                 FROM warranty_claims wc
                 JOIN warranties w ON wc.warranty_id = w.id
                 JOIN users u ON wc.user_id = u.telegram_id
                 WHERE wc.status = 'pending'
                 ORDER BY wc.created_at ASC""")
    claims = c.fetchall()
    conn.close()
    return [{'id': c[0], 'warranty_code': c[10], 'product_name': c[11], 'username': c[12], 'full_name': c[13], 'issue_description': c[4]} for c in claims]

# ==================== SCRIPT STORAGE ====================
class ScriptStorage:
    def __init__(self):
        os.makedirs(SCRIPT_STORAGE_PATH, exist_ok=True)
        os.makedirs(f"{SCRIPT_STORAGE_PATH}/scripts", exist_ok=True)
    
    def add_script(self, name: str, description: str, version: str, user_price: int, category: str, file_path: str) -> bool:
        if not os.path.exists(file_path):
            return False
        file_hash = hashlib.sha256(open(file_path, 'rb').read()).hexdigest()
        file_size = os.path.getsize(file_path)
        script_filename = f"{name}_v{version}_{datetime.now().strftime('%Y%m%d%H%M%S')}.zip"
        target_path = os.path.join(SCRIPT_STORAGE_PATH, "scripts", script_filename)
        shutil.copy2(file_path, target_path)
        reseller_price = int(user_price * 0.75)
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        try:
            c.execute("INSERT INTO scripts (name, description, version, user_price, reseller_price, category, file_path, file_size, file_hash, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                      (name, description, version, user_price, reseller_price, category, target_path, file_size, file_hash, datetime.now()))
            conn.commit()
            return True
        except sqlite3.IntegrityError:
            return False
        finally:
            conn.close()
    
    def get_all_scripts(self) -> List[dict]:
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute("SELECT id, name, description, version, user_price, reseller_price, category, file_size, created_at FROM scripts WHERE is_active = 1 ORDER BY created_at DESC")
        scripts = c.fetchall()
        conn.close()
        return [{'id': s[0], 'name': s[1], 'description': s[2], 'version': s[3], 'user_price': s[4], 'reseller_price': s[5], 'category': s[6], 'file_size': s[7], 'created_at': s[8]} for s in scripts]
    
    def get_script_by_id(self, script_id: int) -> dict:
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute("SELECT id, name, description, version, user_price, reseller_price, category, file_path, file_size, created_at FROM scripts WHERE id = ? AND is_active = 1", (script_id,))
        script = c.fetchone()
        conn.close()
        if script:
            return {'id': script[0], 'name': script[1], 'description': script[2], 'version': script[3], 'user_price': script[4], 'reseller_price': script[5], 'category': script[6], 'file_path': script[7], 'file_size': script[8], 'created_at': script[9]}
        return None
    
    def get_script_price(self, script_id: int, role: str) -> int:
        script = self.get_script_by_id(script_id)
        if not script:
            return 0
        if role == 'admin':
            return 0
        elif role == 'reseller':
            return script['reseller_price']
        return script['user_price']
    
    def generate_license_key(self, script_id: int, buyer_id: int, order_id: int) -> str:
        script = self.get_script_by_id(script_id)
        prefix = script['name'][:4].upper() if script else 'SCRP'
        random_part = ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))
        hash_input = f"{script_id}{buyer_id}{order_id}{datetime.now().timestamp()}"
        hash_part = hashlib.md5(hash_input.encode()).hexdigest()[:6].upper()
        number_part = str(random.randint(1000, 9999))
        return f"{prefix}-{random_part}-{hash_part}-{number_part}"
    
    def purchase_script(self, user_id: int, script_id: int, order_id: int, price: int, role: str) -> dict:
        script = self.get_script_by_id(script_id)
        if not script:
            return None
        license_key = self.generate_license_key(script_id, user_id, order_id)
        expires_at = datetime.now() + timedelta(days=365)
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute("INSERT INTO script_licenses (script_id, license_key, buyer_id, order_id, price_paid, role, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                  (script_id, license_key, user_id, order_id, price, role, expires_at))
        conn.commit()
        conn.close()
        return {'license_key': license_key, 'script_name': script['name'], 'version': script['version'], 'price': price, 'role': role, 'file_path': script['file_path'], 'file_size': script['file_size'], 'expires_at': expires_at}
    
    def deliver_script(self, user_id: int, purchase: dict, context) -> bool:
        file_size_mb = purchase['file_size'] / (1024 * 1024) if purchase['file_size'] else 0
        text = f"""✅ *SCRIPT BERHASIL DIKIRIM!*

🎉 Selamat! Script Anda telah aktif dan siap digunakan.

━━━━━━━━━━━━━━━━━━━
📜 *INFORMASI SCRIPT*
━━━━━━━━━━━━━━━━━━━
📦 *Nama:* {purchase['script_name']}
🔢 *Versi:* {purchase['version']}
🔑 *License Key:* `{purchase['license_key']}`
💰 *Harga:* Rp {purchase['price']:,}
💾 *Ukuran:* {file_size_mb:.1f} MB
👑 *Role:* {purchase['role'].upper()}
📅 *Expired:* {purchase['expires_at'].strftime('%d/%m/%Y')}

━━━━━━━━━━━━━━━━━━━
📥 *DOWNLOAD SCRIPT*
━━━━━━━━━━━━━━━━━━━
Gunakan command: `/download {purchase['license_key']}`

━━━━━━━━━━━━━━━━━━━
🔧 *CARA INSTALL SCRIPT*
━━━━━━━━━━━━━━━━━━━
1️⃣ Download script menggunakan command di atas
2️⃣ Upload ke server/hosting Anda
3️⃣ Extract file zip
4️⃣ Baca file README.txt untuk panduan
5️⃣ Masukkan license key saat diminta

━━━━━━━━━━━━━━━━━━━
⚠️ *PENTING:*
• License key hanya untuk 1 domain/installasi
• Simpan license key dengan baik
• Jangan bagikan license key ke siapapun

📞 *Butuh Bantuan?* Hubungi admin: @panellegal_admin"""
        
        asyncio.create_task(context.bot.send_message(user_id, text, parse_mode='Markdown'))
        try:
            if os.path.exists(purchase['file_path']):
                with open(purchase['file_path'], 'rb') as f:
                    asyncio.create_task(context.bot.send_document(user_id, document=f, filename=f"{purchase['script_name']}_v{purchase['version']}.zip", caption=f"📦 File Script: {purchase['script_name']} v{purchase['version']}"))
        except Exception as e:
            logger.error(f"Failed to send script file: {e}")
        return True
    
    def download_script(self, license_key: str, user_id: int) -> bytes:
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute("SELECT sl.*, sm.file_path FROM script_licenses sl JOIN scripts sm ON sl.script_id = sm.id WHERE sl.license_key = ? AND sl.buyer_id = ?", (license_key, user_id))
        license_data = c.fetchone()
        if not license_data or license_data[6] != 'active':
            conn.close()
            return None
        file_path = license_data[11] if len(license_data) > 11 else None
        if not file_path or not os.path.exists(file_path):
            conn.close()
            return None
        c.execute("UPDATE script_licenses SET download_count = download_count + 1 WHERE license_key = ?", (license_key,))
        c.execute("INSERT INTO script_downloads (license_key, buyer_id) VALUES (?, ?)", (license_key, user_id))
        conn.commit()
        conn.close()
        with open(file_path, 'rb') as f:
            return f.read()
    
    def get_user_scripts(self, user_id: int) -> List[dict]:
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute("SELECT sl.*, sm.name, sm.version FROM script_licenses sl JOIN scripts sm ON sl.script_id = sm.id WHERE sl.buyer_id = ? AND sl.status = 'active' ORDER BY sl.sold_at DESC", (user_id,))
        licenses = c.fetchall()
        conn.close()
        return [{'license_key': l[2], 'script_name': l[10], 'version': l[11], 'price_paid': l[5], 'role': l[7], 'download_count': l[9], 'sold_at': l[8], 'expires_at': l[12]} for l in licenses]

script_storage = ScriptStorage()

# ==================== PANEL CREATION ====================
async def create_panel_and_deliver(order_id: int, user_id: int, ram_size: str, panel_name: str, context: ContextTypes.DEFAULT_TYPE):
    """Membuat panel otomatis menggunakan Pterodactyl API"""
    await context.bot.send_message(user_id, "⚙️ *Sedang membuat panel Anda...*\n\n" + f"📦 Nama Panel: *{panel_name}*\n🎛️ RAM: *{ram_size.upper()}*\n\nProses pembuatan memakan waktu 2-5 menit.\nMohon ditunggu, data login akan dikirim otomatis.", parse_mode='Markdown')
    
    role = get_user_role(user_id) or 'user'
    price = get_panel_price(ram_size, role)
    
    ram_mb = {'1gb': 1024, '3gb': 3072, '5gb': 5120, '8gb': 8192, '10gb': 10240, 'unli': 16384}.get(ram_size, 1024)
    email = f"{panel_name}_{user_id}@panelegal.com"
    username = panel_name.lower().replace('-', '_')[:20]
    
    user_result = pterodactyl.create_user(email=email, username=username, first_name=panel_name[:30], last_name=f"User_{user_id}")
    
    if not user_result['success']:
        for admin_id in ADMIN_IDS:
            await context.bot.send_message(admin_id, f"❌ *GAGAL MEMBUAT PANEL*\n\nUser: {user_id}\nPanel: {panel_name}\nRAM: {ram_size}\nError: {user_result.get('error', 'Unknown')}", parse_mode='Markdown')
        await context.bot.send_message(user_id, "⚠️ *Maaf, terjadi kendala teknis.*\n\nPembuatan panel gagal. Admin akan segera memproses secara manual.\nMohon ditunggu maksimal 15 menit.", parse_mode='Markdown')
        return False
    
    pterodactyl_user_id = user_result['user_id']
    pterodactyl_username = user_result['username']
    pterodactyl_password = user_result['password']
    client_api_key = user_result['api_key']
    
    server_result = pterodactyl.create_server(user_id=pterodactyl_user_id, server_name=panel_name, ram=ram_mb, cpu=100, disk=ram_mb * 10 if ram_mb < 10240 else 102400)
    
    warranty = create_warranty(order_id, user_id, 0, 'panel', f"{panel_name} ({ram_size})", str(pterodactyl_user_id))
    
    text = f"""✅ *PANEL BERHASIL DIBUAT!*

🎉 Selamat! Panel Anda telah aktif dan siap digunakan.

━━━━━━━━━━━━━━━━━━━
🎛️ *INFORMASI PANEL*
━━━━━━━━━━━━━━━━━━━
📦 *Nama Panel:* {panel_name}
🎚️ *RAM:* {ram_size.upper()}
🌐 *URL Panel:* {pterodactyl.panel_url}
👤 *Username:* `{pterodactyl_username}`
🔑 *Password:* `{pterodactyl_password}`
🔐 *API Key (PTLC):* `{client_api_key}`

━━━━━━━━━━━━━━━━━━━
🖥️ *INFORMASI SERVER*
━━━━━━━━━━━━━━━━━━━
🆔 *Server ID:* {server_result.get('server_id', 'Pending')}
🌐 *IP Server:* {server_result.get('allocation', {}).get('ip', 'Pending')}
🔌 *Port:* {server_result.get('allocation', {}).get('port', 'Pending')}

━━━━━━━━━━━━━━━━━━━
🔧 *CARA AKSES PANEL*
━━━━━━━━━━━━━━━━━━━
1️⃣ Buka URL panel: {pterodactyl.panel_url}
2️⃣ Login menggunakan username & password di atas
3️⃣ Ganti password setelah login untuk keamanan
4️⃣ Gunakan API Key untuk integrasi

━━━━━━━━━━━━━━━━━━━
🎫 *GARANSI 1 BULAN*
━━━━━━━━━━━━━━━━━━━
🆔 *Kode Garansi:* `{warranty['code']}`
📅 *Aktif Sampai:* {warranty['expires_at'].strftime('%d %B %Y')}

Panel Anda dilindungi garansi 1 bulan!
Jika ada kendala, klaim garansi di menu Garansi.

📞 *Butuh Bantuan?* Hubungi admin: @panellegal_admin"""

    await context.bot.send_message(user_id, text, parse_mode='Markdown')
    
    from io import BytesIO
    info_file = f"""PANEL INFORMATION - {panel_name}
================================
URL PANEL: {pterodactyl.panel_url}
USERNAME: {pterodactyl_username}
PASSWORD: {pterodactyl_password}
API KEY (PTLC): {client_api_key}
SERVER ID: {server_result.get('server_id', 'Pending')}
IP: {server_result.get('allocation', {}).get('ip', 'Pending')}
PORT: {server_result.get('allocation', {}).get('port', 'Pending')}
GARANSI: {warranty['code']}
CREATED: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
EXPIRE: {warranty['expires_at'].strftime('%Y-%m-%d')}
================================
SAVE THIS INFORMATION SECURELY
================================
"""
    file_io = BytesIO(info_file.encode())
    file_io.name = f"panel_{panel_name}_info.txt"
    await context.bot.send_document(user_id, document=file_io, filename=file_io.name, caption="📄 *File informasi panel* (Simpan dengan aman)")
    
    for admin_id in ADMIN_IDS:
        await context.bot.send_message(admin_id, f"✅ *PANEL BERHASIL DIBUAT OTOMATIS*\n\nUser: {user_id}\nNama: {panel_name}\nRAM: {ram_size.upper()}\nPterodactyl ID: {pterodactyl_user_id}\nServer ID: {server_result.get('server_id', 'Pending')}\nGaransi: {warranty['code']}", parse_mode='Markdown')
    
    update_order_status(order_id, 'delivered')
    
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("INSERT INTO panel_users (user_id, pterodactyl_user_id, panel_name, ram_size, username, password, api_key, server_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
              (user_id, pterodactyl_user_id, panel_name, ram_size, pterodactyl_username, pterodactyl_password, client_api_key, str(server_result.get('server_id', ''))))
    conn.commit()
    conn.close()
    return True

# ==================== HANDLERS ====================
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user = update.effective_user
    referrer = None
    if context.args and context.args[0].startswith('ref_'):
        try:
            referrer = int(context.args[0].replace('ref_', ''))
        except:
            pass
    register_user(user.id, user.username, user.full_name, referrer)
    stats = get_user_stats(user.id)
    role = stats.get('role', 'user')
    role_emoji = {'admin': '👑', 'reseller': '💎', 'user': '👤'}.get(role, '👤')
    text = f"""{role_emoji} *PANEL LEGAL BY PANJI* {role_emoji}

Halo *{user.full_name}*!

👑 *Role:* {role.upper()}
💰 *Saldo:* Rp {stats.get('balance', 0):,}

━━━━━━━━━━━━━━━━━━━
🎛️ *PANEL TERSEDIA*
━━━━━━━━━━━━━━━━━━━
• 1GB RAM - Rp 2.000 (User) / Rp 1.500 (Reseller)
• 3GB RAM - Rp 5.000 / Rp 4.500
• 5GB RAM - Rp 7.000 / Rp 6.500
• 8GB RAM - Rp 10.000 / Rp 9.500
• 10GB RAM - Rp 12.000 / Rp 11.500
• UNLIMITED - Rp 13.500 / Rp 12.000

📜 *SCRIPT PREMIUM* juga tersedia!

💡 *Ingin jadi Reseller?* Upgrade hanya Rp 5.000!
Dapatkan diskon 25% dan komisi 10% dari downline.

Klik menu di bawah untuk mulai!"""
    keyboard = [
        [InlineKeyboardButton("🎛️ Beli Panel", callback_data="beli_panel")],
        [InlineKeyboardButton("📜 Beli Script", callback_data="beli_script")],
        [InlineKeyboardButton("💰 Top Up Saldo", callback_data="topup")],
        [InlineKeyboardButton("🎫 Garansi Panel", callback_data="menu_garansi")],
        [InlineKeyboardButton("💎 Upgrade Reseller", callback_data="upgrade_reseller")],
        [InlineKeyboardButton("📞 Kontak Admin", url="https://t.me/panellegal_admin")]
    ]
    await update.message.reply_text(text, parse_mode='Markdown', reply_markup=InlineKeyboardMarkup(keyboard))

async def beli_panel_menu(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    role = get_user_role(query.from_user.id) or 'user'
    text = f"""🎛️ *PILIH UKURAN PANEL*

Role Anda: *{role.upper()}*

━━━━━━━━━━━━━━━━━━━
📊 *DAFTAR PANEL*
━━━━━━━━━━━━━━━━━━━"""
    buttons = []
    ram_sizes = ['1gb', '3gb', '5gb', '8gb', '10gb', 'unli']
    ram_display = {'1gb': '1 GB', '3gb': '3 GB', '5gb': '5 GB', '8gb': '8 GB', '10gb': '10 GB', 'unli': 'UNLIMITED'}
    for ram in ram_sizes:
        price = get_panel_price(ram, role)
        price_display = "GRATIS" if role == 'admin' else f"Rp {price:,}"
        text += f"\n• *{ram_display[ram]}*: {price_display}"
        buttons.append([InlineKeyboardButton(f"🎛️ {ram_display[ram]} - {price_display}", callback_data=f"pilih_ram_{ram}")])
    text += "\n\n━━━━━━━━━━━━━━━━━━━\n✅ *Garansi 1 bulan* untuk semua panel\n🚀 *Auto create panel* setelah pembelian\n💳 *Top up saldo* terlebih dahulu\n\nPilih ukuran RAM panel yang diinginkan:"
    buttons.append([InlineKeyboardButton("🔙 Kembali ke Menu", callback_data="main_menu")])
    await query.edit_message_text(text, parse_mode='Markdown', reply_markup=InlineKeyboardMarkup(buttons))

async def pilih_ram(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    ram_size = query.data.replace("pilih_ram_", "")
    role = get_user_role(query.from_user.id) or 'user'
    panel = get_panel_by_ram(ram_size)
    if not panel:
        await query.edit_message_text("❌ Panel tidak ditemukan.")
        return
    price = get_panel_price(ram_size, role)
    price_display = "GRATIS" if role == 'admin' else f"Rp {price:,}"
    context.user_data['selected_ram'] = ram_size
    context.user_data['selected_panel_price'] = price
    text = f"""🎛️ *{panel['name']}*

💰 *Harga:* {price_display}
🎚️ *RAM:* {panel['ram'] if panel['ram'] > 0 else 'Unlimited'} MB
📝 *Deskripsi:* {panel['description']}

━━━━━━━━━━━━━━━━━━━
✏️ *NAMAKAN PANEL ANDA*
━━━━━━━━━━━━━━━━━━━

Silakan masukkan nama untuk panel Anda.

*Contoh:*
• `panel-bisnis`
• `my-website`
• `project-ku`

Nama panel akan menjadi identifier panel Anda.

Ketik nama panel Anda di sini:"""
    await query.edit_message_text(text, parse_mode='Markdown')
    context.user_data['waiting_for_panel_name'] = True

async def process_panel_name(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not context.user_data.get('waiting_for_panel_name'):
        return
    user_id = update.effective_user.id
    panel_name = update.message.text.strip()
    role = get_user_role(user_id) or 'user'
    ram_size = context.user_data.get('selected_ram')
    price = context.user_data.get('selected_panel_price')
    if not panel_name:
        await update.message.reply_text("❌ Nama panel tidak boleh kosong!")
        return
    panel_name_clean = re.sub(r'[^a-zA-Z0-9-]', '-', panel_name.lower()).strip('-')
    if len(panel_name_clean) < 3:
        await update.message.reply_text("❌ Nama panel terlalu pendek! Minimal 3 karakter.")
        return
    if len(panel_name_clean) > 30:
        await update.message.reply_text("❌ Nama panel terlalu panjang! Maksimal 30 karakter.")
        return
    context.user_data['panel_name'] = panel_name_clean
    stats = get_user_stats(user_id)
    balance = stats.get('balance', 0)
    if role != 'admin' and balance < price:
        need_topup = price - balance
        await update.message.reply_text(f"❌ *Saldo Tidak Cukup!*\n\nPanel: {panel_name_clean}\nRAM: {ram_size.upper()}\nHarga: Rp {price:,}\nSaldo: Rp {balance:,}\nKekurangan: Rp {need_topup:,}\n\nSilakan top up saldo terlebih dahulu.\nKlik /topup untuk top up.", parse_mode='Markdown')
        return
    order_id = add_order(user_id, 'panel', f"{panel_name_clean} ({ram_size.upper()})", 1, price)
    if role != 'admin':
        deduct_balance(user_id, price, f"Pembelian Panel {panel_name_clean} ({ram_size})")
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute("SELECT referrer_id FROM users WHERE telegram_id = ?", (user_id,))
        referrer = c.fetchone()
        conn.close()
        if referrer and referrer[0] and get_user_role(referrer[0]) == 'reseller':
            add_commission(referrer[0], user_id, order_id, price, 10)
    await update.message.reply_text(f"✅ *Pembelian Berhasil!*\n\n📦 Nama Panel: *{panel_name_clean}*\n🎚️ RAM: *{ram_size.upper()}*\n💰 Harga: Rp {price:,}\n💵 Sisa Saldo: Rp {get_user_stats(user_id).get('balance', 0):,}\n\n🔄 *Sedang membuat panel Anda...*\nMohon ditunggu 2-5 menit.\nData login panel akan dikirim otomatis.", parse_mode='Markdown')
    await create_panel_and_deliver(order_id, user_id, ram_size, panel_name_clean, context)
    context.user_data.pop('waiting_for_panel_name', None)
    context.user_data.pop('selected_ram', None)
    context.user_data.pop('selected_panel_price', None)
    context.user_data.pop('panel_name', None)

async def my_panels(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT panel_name, ram_size, username, password, api_key, server_id, created_at FROM panel_users WHERE user_id = ? ORDER BY created_at DESC", (user_id,))
    panels = c.fetchall()
    c.execute("SELECT warranty_code, product_name, expires_at FROM warranties WHERE user_id = ? AND product_type = 'panel' ORDER BY created_at DESC", (user_id,))
    warranties = c.fetchall()
    conn.close()
    if not panels and not warranties:
        await update.message.reply_text("📭 *Panel Saya*\n\nAnda belum memiliki panel.\nBeli panel sekarang di menu /menu", parse_mode='Markdown', reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🎛️ Beli Panel", callback_data="beli_panel")]]))
        return
    text = "🎛️ *DAFTAR PANEL SAYA*\n\n"
    for panel in panels:
        text += f"┌ *{panel[0]}* ({panel[1].upper()})\n├ 👤 Username: `{panel[2]}`\n├ 🔑 Password: `{panel[3]}`\n├ 🔐 API Key: `{panel[4][:20]}...`\n├ 🖥️ Server ID: {panel[5]}\n└ 📅 Dibeli: {panel[6].split()[0] if panel[6] else '-'}\n\n"
    for warranty in warranties:
        days_left = 0
        if warranty[2]:
            exp_date = datetime.strptime(warranty[2], '%Y-%m-%d %H:%M:%S')
            days_left = (exp_date - datetime.now()).days
        text += f"🎫 *Garansi: {warranty[1]}*\n└ 🆔 Kode: `{warranty[0]}`\n└ ⏰ Sisa: {days_left} hari\n\n"
    text += f"\n📌 *Cara Akses Panel:*\n• Login menggunakan username & password di atas\n• Ganti password setelah login\n• API Key (PTLC) untuk integrasi dengan aplikasi Anda\n\n🔗 *URL Panel:* {pterodactyl.panel_url}"
    await update.message.reply_text(text, parse_mode='Markdown')

async def beli_script_menu(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    role = get_user_role(query.from_user.id) or 'user'
    scripts = script_storage.get_all_scripts()
    if not scripts:
        await query.edit_message_text("📜 *Daftar Script*\n\nBelum ada script yang tersedia.", parse_mode='Markdown')
        return
    text = f"📜 *DAFTAR SCRIPT PREMIUM*\n\nRole Anda: *{role.upper()}*\n\n"
    buttons = []
    for script in scripts:
        price = script_storage.get_script_price(script['id'], role)
        price_display = "GRATIS" if role == 'admin' else f"Rp {price:,}"
        file_size_mb = script['file_size'] / (1024 * 1024) if script['file_size'] else 0
        text += f"┌ *{script['name']}* v{script['version']}\n├ 💰 Harga: {price_display}\n├ 📦 Size: {file_size_mb:.1f} MB\n├ 📝 {script['description'][:50]}...\n└ 🆔 ID: #{script['id']}\n\n"
        buttons.append([InlineKeyboardButton(f"🛒 Beli {script['name']} - {price_display}", callback_data=f"pilih_script_{script['id']}")])
    text += "\n━━━━━━━━━━━━━━━━━━━\n✅ *Auto delivery* setelah pembelian\n💳 *Top up saldo* terlebih dahulu\n\n*Catatan:* Script TIDAK mendapatkan garansi"
    buttons.append([InlineKeyboardButton("🔙 Kembali ke Menu", callback_data="main_menu")])
    await query.edit_message_text(text, parse_mode='Markdown', reply_markup=InlineKeyboardMarkup(buttons))

async def pilih_script(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    script_id = int(query.data.replace("pilih_script_", ""))
    role = get_user_role(query.from_user.id) or 'user'
    script = script_storage.get_script_by_id(script_id)
    if not script:
        await query.edit_message_text("❌ Script tidak ditemukan.")
        return
    price = script_storage.get_script_price(script_id, role)
    price_display = "GRATIS" if role == 'admin' else f"Rp {price:,}"
    file_size_mb = script['file_size'] / (1024 * 1024) if script['file_size'] else 0
    text = f"""📜 *{script['name']}* v{script['version']}

📝 *Deskripsi:*
{script['description']}

━━━━━━━━━━━━━━━━━━━
📊 *SPESIFIKASI*
━━━━━━━━━━━━━━━━━━━
📦 Ukuran: {file_size_mb:.1f} MB
📅 Rilis: {script['created_at'].split()[0] if script['created_at'] else '-'}

━━━━━━━━━━━━━━━━━━━
💰 *HARGA*
━━━━━━━━━━━━━━━━━━━
Role Anda: *{role.upper()}*
Harga: {price_display}

*Harga Normal (User):* Rp {script['user_price']:,}
*Harga Reseller:* Rp {script['reseller_price']:,} (Diskon 25%)

━━━━━━━━━━━━━━━━━━━
✨ *YANG ANDA DAPATKAN*
━━━━━━━━━━━━━━━━━━━
✅ 1x License Key Original
✅ 1x File Script Lengkap (Auto Kirim)
✅ Dokumentasi Instalasi
✅ Update Gratis 1 bulan

*Catatan:* Script TIDAK mendapatkan garansi

💡 *Pembayaran menggunakan saldo*
Cek saldo: /saldo

Konfirmasi pembelian script ini?"""
    buttons = [
        [InlineKeyboardButton("✅ Beli Sekarang", callback_data=f"checkout_script_{script_id}")],
        [InlineKeyboardButton("🔙 Kembali ke Daftar Script", callback_data="beli_script")]
    ]
    await query.edit_message_text(text, parse_mode='Markdown', reply_markup=InlineKeyboardMarkup(buttons))

async def checkout_script(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    script_id = int(query.data.replace("checkout_script_", ""))
    user_id = query.from_user.id
    role = get_user_role(user_id) or 'user'
    script = script_storage.get_script_by_id(script_id)
    if not script:
        await query.edit_message_text("❌ Script tidak ditemukan.")
        return
    price = script_storage.get_script_price(script_id, role)
    stats = get_user_stats(user_id)
    balance = stats.get('balance', 0)
    if role != 'admin' and balance < price:
        need_topup = price - balance
        await query.edit_message_text(f"❌ *Saldo Tidak Cukup!*\n\nScript: {script['name']}\nHarga: Rp {price:,}\nSaldo: Rp {balance:,}\nKekurangan: Rp {need_topup:,}\n\nSilakan top up saldo terlebih dahulu.", parse_mode='Markdown')
        return
    order_id = add_order(user_id, 'script', script['name'], 1, price)
    if role != 'admin':
        deduct_balance(user_id, price, f"Pembelian Script {script['name']}")
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute("SELECT referrer_id FROM users WHERE telegram_id = ?", (user_id,))
        referrer = c.fetchone()
        conn.close()
        if referrer and referrer[0] and get_user_role(referrer[0]) == 'reseller':
            add_commission(referrer[0], user_id, order_id, price, 10)
    purchase = script_storage.purchase_script(user_id, script_id, order_id, price, role)
    if not purchase:
        await query.edit_message_text("❌ Gagal memproses pembelian.", parse_mode='Markdown')
        return
    await query.edit_message_text(f"✅ *Pembelian Berhasil!*\n\nScript: {script['name']}\nHarga: Rp {price:,}\nSisa Saldo: Rp {get_user_stats(user_id).get('balance', 0):,}\n\n🔄 Sedang mengirim script...\nFile dan license key akan dikirim otomatis.", parse_mode='Markdown')
    await script_storage.deliver_script(user_id, purchase, context)
    update_order_status(order_id, 'delivered')

async def download_script_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not context.args:
        await update.message.reply_text("📥 *Download Script*\n\nGunakan: `/download [LICENSE_KEY]`\n\nLicense key bisa dilihat di /myscripts", parse_mode='Markdown')
        return
    license_key = context.args[0]
    user_id = update.effective_user.id
    file_data = script_storage.download_script(license_key, user_id)
    if not file_data:
        await update.message.reply_text("❌ Gagal download. License key tidak valid atau bukan milik Anda.", parse_mode='Markdown')
        return
    from io import BytesIO
    file_io = BytesIO(file_data)
    file_io.name = f"script_{license_key}.zip"
    await update.message.reply_document(document=file_io, filename=file_io.name, caption=f"📦 Script - License: `{license_key}`")

async def my_scripts(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    scripts = script_storage.get_user_scripts(user_id)
    if not scripts:
        await update.message.reply_text("📭 Anda belum memiliki script.", parse_mode='Markdown')
        return
    text = "📜 *DAFTAR SCRIPT SAYA*\n\n"
    for s in scripts:
        text += f"┌ *{s['script_name']}* v{s['version']}\n├ 🔑 `{s['license_key']}`\n├ 💰 Rp {s['price_paid']:,}\n├ 👑 {s['role'].upper()}\n├ 📥 Download: {s['download_count']}x\n├ 📅 Dibeli: {s['sold_at'].split()[0] if s['sold_at'] else '-'}\n└ ⏰ Expired: {s['expires_at'].split()[0] if s['expires_at'] else '-'}\n\n"
    text += "\n📌 *Download:* `/download [LICENSE_KEY]`"
    await update.message.reply_text(text, parse_mode='Markdown')

async def topup_menu(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    if query:
        await query.answer()
        message_func = query.edit_message_text
    else:
        message_func = update.message.reply_text
    text = """💰 *TOP UP SALDO*

Minimal top up: *Rp 1,000*

Pilih nominal top up:"""
    buttons = [
        [InlineKeyboardButton("Rp 10,000", callback_data="topup_10000"), InlineKeyboardButton("Rp 25,000", callback_data="topup_25000"), InlineKeyboardButton("Rp 50,000", callback_data="topup_50000")],
        [InlineKeyboardButton("Rp 100,000", callback_data="topup_100000"), InlineKeyboardButton("Rp 250,000", callback_data="topup_250000"), InlineKeyboardButton("Rp 500,000", callback_data="topup_500000")],
        [InlineKeyboardButton("💳 Nominal Lain", callback_data="topup_custom")],
        [InlineKeyboardButton("🔙 Kembali ke Menu", callback_data="main_menu")]
    ]
    if query:
        await message_func(text, parse_mode='Markdown', reply_markup=InlineKeyboardMarkup(buttons))
    else:
        await message_func(text, parse_mode='Markdown', reply_markup=InlineKeyboardMarkup(buttons))

async def topup_nominal(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    nominal = int(query.data.replace("topup_", ""))
    context.user_data['topup_amount'] = nominal
    text = f"""💰 *TOP UP SALDO*

Nominal: *Rp {nominal:,}*

Pilih metode pembayaran:"""
    buttons = [
        [InlineKeyboardButton("🏦 Transfer Bank (BCA)", callback_data="payment_bca")],
        [InlineKeyboardButton("📱 QRIS (Semua Bank)", callback_data="payment_qris")],
        [InlineKeyboardButton("🔙 Kembali", callback_data="topup")]
    ]
    await query.edit_message_text(text, parse_mode='Markdown', reply_markup=InlineKeyboardMarkup(buttons))

async def topup_custom(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    text = """💰 *TOP UP NOMINAL CUSTOM*

Masukkan nominal top up (min Rp 1,000, max Rp 10,000,000, kelipatan Rp 1,000)

Contoh: `50000`

Ketik nominal Anda:"""
    await query.edit_message_text(text, parse_mode='Markdown')
    context.user_data['waiting_for_custom_topup'] = True

async def process_custom_topup(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not context.user_data.get('waiting_for_custom_topup'):
        return
    try:
        nominal = int(update.message.text.strip())
        if nominal < 1000:
            await update.message.reply_text("❌ Minimal top up Rp 1,000!")
            return
        if nominal > 10000000:
            await update.message.reply_text("❌ Maksimal top up Rp 10,000,000!")
            return
        if nominal % 1000 != 0:
            await update.message.reply_text("❌ Nominal harus kelipatan Rp 1,000!")
            return
        context.user_data['topup_amount'] = nominal
        text = f"""💰 *TOP UP SALDO*

Nominal: *Rp {nominal:,}*

Pilih metode pembayaran:"""
        buttons = [
            [InlineKeyboardButton("🏦 Transfer Bank (BCA)", callback_data="payment_bca")],
            [InlineKeyboardButton("📱 QRIS (Semua Bank)", callback_data="payment_qris")],
            [InlineKeyboardButton("🔙 Kembali", callback_data="topup")]
        ]
        await update.message.reply_text(text, parse_mode='Markdown', reply_markup=InlineKeyboardMarkup(buttons))
        context.user_data['waiting_for_custom_topup'] = False
    except ValueError:
        await update.message.reply_text("❌ Nominal tidak valid! Masukkan angka.")

async def topup_payment_method(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    method = query.data.replace("payment_", "")
    amount = context.user_data.get('topup_amount', 0)
    if amount == 0:
        await query.edit_message_text("❌ Silakan pilih nominal terlebih dahulu.")
        return
    request_code = generate_topup_code()
    text = f"""💰 *INSTRUKSI TOP UP*

🆔 *Kode:* `{request_code}`
💵 *Nominal:* Rp {amount:,}
💳 *Metode:* {method.upper()}

━━━━━━━━━━━━━━━━━━━
💳 *Informasi Pembayaran*
━━━━━━━━━━━━━━━━━━━
🏦 Bank BCA: 1234567890
📱 a.n PT PANEL LEGAL

━━━━━━━━━━━━━━━━━━━
📝 *Cara Top Up:*
1️⃣ Transfer sesuai nominal Rp {amount:,}
2️⃣ Sertakan kode `{request_code}` di keterangan
3️⃣ Upload bukti transfer (kirim foto)
4️⃣ Admin akan konfirmasi, saldo auto masuk

📤 *Upload bukti transfer dengan mengirim foto di chat ini*"""
    context.user_data['pending_topup'] = {'amount': amount, 'method': method, 'request_code': request_code}
    await query.edit_message_text(text, parse_mode='Markdown')

async def upload_topup_proof(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    pending = context.user_data.get('pending_topup')
    if not pending:
        await update.message.reply_text("❌ Tidak ada top up yang sedang diproses. Gunakan /topup untuk memulai.")
        return
    if not update.message.photo:
        await update.message.reply_text("❌ Silakan kirim FOTO bukti transfer.")
        return
    photo = update.message.photo[-1]
    proof_info = f"photo_id_{photo.file_id}"
    request = create_topup_request(user_id, pending['amount'], pending['method'], proof_info)
    if not request:
        await update.message.reply_text("❌ Gagal membuat request. Minimal top up Rp 1,000.")
        return
    await update.message.reply_text(f"✅ *Request Top Up Dikirim!*\n\n🆔 Kode: `{request['code']}`\n💰 Rp {pending['amount']:,}\n\nAdmin akan konfirmasi pembayaran Anda.", parse_mode='Markdown')
    for admin_id in ADMIN_IDS:
        await context.bot.send_message(admin_id, f"🔔 *REQUEST TOP UP*\n\nKode: `{request['code']}`\nUser: {update.effective_user.full_name}\nNominal: Rp {pending['amount']:,}\n\nGunakan /admin untuk konfirmasi.", parse_mode='Markdown')
        await context.bot.send_photo(admin_id, photo=photo.file_id, caption=f"Bukti Transfer - {request['code']}")
    context.user_data.pop('pending_topup', None)

async def my_balance(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    stats = get_user_stats(user_id)
    role = stats.get('role', 'user')
    text = f"""💰 *INFORMASI SALDO*

👑 Role: {role.upper()}
💰 Saldo: Rp {stats.get('balance', 0):,}
📊 Total Belanja: Rp {stats.get('total_spent', 0):,}"""
    if role == 'reseller':
        text += f"\n💵 Komisi Pending: Rp {stats.get('pending', 0):,}\n✅ Komisi Dibayar: Rp {stats.get('paid', 0):,}\n👥 Downline: {stats.get('downline_count', 0)} orang"
    text += "\n\n💡 *Top Up:* /topup"
    await update.message.reply_text(text, parse_mode='Markdown')

async def upgrade_reseller(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    if query:
        await query.answer()
        user_id = query.from_user.id
        message_func = query.edit_message_text
    else:
        user_id = update.effective_user.id
        message_func = update.message.reply_text
    current_role = get_user_role(user_id)
    if current_role == 'reseller':
        await message_func("✅ Anda sudah menjadi Reseller!", parse_mode='Markdown')
        return
    if current_role == 'admin':
        await message_func("👑 Anda adalah Admin.", parse_mode='Markdown')
        return
    stats = get_user_stats(user_id)
    balance = stats.get('balance', 0)
    text = f"""💎 *UPGRADE KE RESELLER*

Biaya: *Rp 5,000*

✨ *Keuntungan:*
✅ Diskon 25% untuk semua panel
✅ Komisi 10% dari pembelian downline
✅ Harga panel lebih murah

💰 *Saldo Anda:* Rp {balance:,}

Upgrade sekarang?"""
    buttons = [
        [InlineKeyboardButton("✅ Ya, Upgrade", callback_data="confirm_upgrade")],
        [InlineKeyboardButton("❌ Batal", callback_data="main_menu")]
    ]
    await message_func(text, parse_mode='Markdown', reply_markup=InlineKeyboardMarkup(buttons))

async def confirm_upgrade(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    user_id = query.from_user.id
    success = upgrade_to_reseller(user_id, 5000)
    if success:
        bot_username = context.bot.username
        text = f"""✅ *Selamat! Anda Kini Reseller!*

🔗 *Link Referral:* `https://t.me/{bot_username}?start=ref_{user_id}`

✨ *Keuntungan:*
• Diskon 25% untuk semua panel
• Komisi 10% dari pembelian downline

📈 *Cek Statistik:* /mydownline | /mycommission"""
        await query.edit_message_text(text, parse_mode='Markdown')
        for admin_id in ADMIN_IDS:
            await context.bot.send_message(admin_id, f"🆕 *User Upgrade Reseller*\n\nUser: {query.from_user.full_name}\nID: {user_id}", parse_mode='Markdown')
    else:
        await query.edit_message_text("❌ Gagal upgrade. Pastikan saldo Rp 5,000.", parse_mode='Markdown')

async def my_downline(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    if get_user_role(user_id) != 'reseller':
        await update.message.reply_text("❌ Fitur ini hanya untuk reseller.")
        return
    downlines = get_reseller_downline(user_id)
    if not downlines:
        bot_username = context.bot.username
        await update.message.reply_text(f"📭 Belum ada downline.\n\n🔗 Link Referral: `https://t.me/{bot_username}?start=ref_{user_id}`", parse_mode='Markdown')
        return
    text = f"👥 *DOWNLINE ({len(downlines)} orang)*\n\n"
    for i, d in enumerate(downlines[:10], 1):
        text += f"{i}. {d['full_name']} (@{d['username']})\n   └ Total Belanja: Rp {d['total_spent']:,}\n\n"
    await update.message.reply_text(text, parse_mode='Markdown')

async def my_commission(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    if get_user_role(user_id) != 'reseller':
        await update.message.reply_text("❌ Fitur ini hanya untuk reseller.")
        return
    stats = get_user_stats(user_id)
    text = f"""💰 *KOMISI RESELLER*

🟢 Pending: Rp {stats.get('pending', 0):,}
✅ Dibayar: Rp {stats.get('paid', 0):,}
📈 Total: Rp {stats.get('total_commission', 0):,}
👥 Downline: {stats.get('downline_count', 0)} orang

🔗 Link Referral: `https://t.me/{context.bot.username}?start=ref_{user_id}`"""
    await update.message.reply_text(text, parse_mode='Markdown')

async def menu_garansi(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    if query:
        await query.answer()
    text = """🎫 *GARANSI PANEL*

*Garansi 1 bulan hanya untuk produk PANEL!*

✅ Panel mendapat garansi 1 bulan
✅ Klaim jika panel error/tidak bisa diakses
❌ Script TIDAK mendapatkan garansi

🔧 *Cara Klaim:*
1. Cek garansi di "Cek Garansi Saya"
2. Pilih panel yang ingin diklaim
3. Jelaskan masalah
4. Admin proses 1x24 jam

📞 Butuh bantuan? Hubungi admin: @panellegal_admin"""
    buttons = [
        [InlineKeyboardButton("🎫 Cek Garansi", callback_data="cek_garansi")],
        [InlineKeyboardButton("🔧 Klaim Garansi", callback_data="klaim_garansi")],
        [InlineKeyboardButton("📋 Status Klaim", callback_data="status_klaim")],
        [InlineKeyboardButton("🏠 Menu Utama", callback_data="main_menu")]
    ]
    if query:
        await query.edit_message_text(text, parse_mode='Markdown', reply_markup=InlineKeyboardMarkup(buttons))
    else:
        await update.message.reply_text(text, parse_mode='Markdown', reply_markup=InlineKeyboardMarkup(buttons))

async def cek_garansi(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    user_id = query.from_user.id
    warranties = get_user_warranties(user_id)
    if not warranties:
        text = "ℹ️ Anda belum memiliki garansi panel.\n\nGaransi diberikan OTOMATIS untuk setiap pembelian PANEL.\n\nBeli panel sekarang untuk mendapatkan garansi 1 bulan!"
        buttons = [[InlineKeyboardButton("🎛️ Beli Panel", callback_data="beli_panel")], [InlineKeyboardButton("🔙 Kembali", callback_data="menu_garansi")]]
        await query.edit_message_text(text, parse_mode='Markdown', reply_markup=InlineKeyboardMarkup(buttons))
        return
    text = "🎫 *GARANSI PANEL ANDA*\n\n"
    active = 0
    for w in warranties:
        status_emoji = {'active': '✅', 'claimed': '🔄', 'expired': '⏰'}.get(w['status'], '⚪')
        if w['days_left'] > 0 and w['status'] == 'active':
            active += 1
        text += f"{status_emoji} *{w['product_name']}*\n└ 🆔 `{w['code']}`\n└ 📅 Exp: {w['expires_at'].split()[0] if w['expires_at'] else '-'}\n"
        if w['status'] == 'active' and w['days_left'] > 0:
            text += f"└ ⏰ Sisa: {w['days_left']} hari\n"
        text += "\n"
    text += f"\n📊 Total: {len(warranties)} | ✅ Aktif: {active}"
    buttons = [[InlineKeyboardButton("🔧 Klaim Garansi", callback_data="klaim_garansi")], [InlineKeyboardButton("🔙 Kembali", callback_data="menu_garansi")]]
    await query.edit_message_text(text, parse_mode='Markdown', reply_markup=InlineKeyboardMarkup(buttons))

async def klaim_garansi_form(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    user_id = query.from_user.id
    warranties = get_user_warranties(user_id)
    active_warranties = [w for w in warranties if w['status'] == 'active' and w['days_left'] > 0]
    if not active_warranties:
        await query.edit_message_text("⚠️ Tidak ada garansi aktif yang bisa diklaim.", parse_mode='Markdown')
        return
    text = "🔧 *KLAIM GARANSI*\n\nPilih panel yang ingin diklaim:\n\n"
    buttons = []
    for w in active_warranties:
        text += f"• *{w['product_name']}*\n  └ Kode: `{w['code']}`\n  └ Sisa: {w['days_left']} hari\n\n"
        buttons.append([InlineKeyboardButton(f"📦 {w['product_name']}", callback_data=f"claim_select_{w['id']}")])
    buttons.append([InlineKeyboardButton("🔙 Kembali", callback_data="menu_garansi")])
    await query.edit_message_text(text, parse_mode='Markdown', reply_markup=InlineKeyboardMarkup(buttons))

async def claim_select_warranty(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    warranty_id = int(query.data.replace("claim_select_", ""))
    context.user_data['claim_warranty_id'] = warranty_id
    text = """🔧 *KLAIM GARANSI*

Pilih jenis masalah:

1️⃣ Server Down / Tidak Bisa Diakses
2️⃣ Performa Menurun
3️⃣ Error Teknis
4️⃣ Masalah Lainnya"""
    buttons = [
        [InlineKeyboardButton("🔴 Server Down", callback_data=f"claim_issue_1_{warranty_id}")],
        [InlineKeyboardButton("🐢 Performa Menurun", callback_data=f"claim_issue_2_{warranty_id}")],
        [InlineKeyboardButton("⚠️ Error Teknis", callback_data=f"claim_issue_3_{warranty_id}")],
        [InlineKeyboardButton("📝 Masalah Lain", callback_data=f"claim_issue_4_{warranty_id}")],
        [InlineKeyboardButton("🔙 Batal", callback_data="menu_garansi")]
    ]
    await query.edit_message_text(text, parse_mode='Markdown', reply_markup=InlineKeyboardMarkup(buttons))

async def claim_issue_selected(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    data = query.data.replace("claim_issue_", "")
    issue_type_id, warranty_id = data.split('_')
    issue_types = {'1': 'server_down', '2': 'performance', '3': 'error', '4': 'other'}
    issue_type = issue_types.get(issue_type_id, 'other')
    context.user_data['claim_issue_type'] = issue_type
    context.user_data['claim_warranty_id'] = int(warranty_id)
    text = """🔧 *KLAIM GARANSI*

Silakan jelaskan masalah yang Anda alami secara detail:
• Kapan masalah terjadi?
• Apa yang Anda lakukan?
• Ada error message?

Ketik deskripsi masalah Anda:"""
    await query.edit_message_text(text, parse_mode='Markdown')
    context.user_data['waiting_for_claim_description'] = True

async def process_claim_description(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not context.user_data.get('waiting_for_claim_description'):
        return
    user_id = update.effective_user.id
    description = update.message.text.strip()
    warranty_id = context.user_data.get('claim_warranty_id')
    issue_type = context.user_data.get('claim_issue_type')
    if not warranty_id or not issue_type:
        await update.message.reply_text("❌ Sesuatu salah, silakan coba lagi.")
        return
    if len(description) < 10:
        await update.message.reply_text("❌ Deskripsi terlalu singkat. Minimal 10 karakter.")
        return
    claim_id = claim_warranty(warranty_id, user_id, issue_type, description)
    await update.message.reply_text(f"✅ *Klaim Garansi Dikirim!*\n\nID Klaim: #{claim_id}\n\nAdmin akan memproses dalam 1x24 jam.\nCek status di menu Status Klaim.", parse_mode='Markdown')
    for admin_id in ADMIN_IDS:
        await context.bot.send_message(admin_id, f"🔔 *KLAIM GARANSI*\n\nID: #{claim_id}\nUser: {update.effective_user.full_name}\nMasalah: {description[:200]}", parse_mode='Markdown')
    context.user_data['waiting_for_claim_description'] = False
    context.user_data.pop('claim_warranty_id', None)
    context.user_data.pop('claim_issue_type', None)

async def status_klaim(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    user_id = query.from_user.id
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("""SELECT wc.*, w.warranty_code, w.product_name
                 FROM warranty_claims wc
                 JOIN warranties w ON wc.warranty_id = w.id
                 WHERE wc.user_id = ?
                 ORDER BY wc.created_at DESC""", (user_id,))
    claims = c.fetchall()
    conn.close()
    if not claims:
        await query.edit_message_text("📋 Anda belum memiliki klaim garansi.", parse_mode='Markdown')
        return
    status_map = {'pending': '⏳ Menunggu', 'approved': '✅ Disetujui', 'rejected': '❌ Ditolak', 'resolved': '🎉 Selesai'}
    text = "📋 *STATUS KLAIM GARANSI*\n\n"
    for c in claims:
        text += f"┌ Klaim #{c[0]}\n├ {c[10]} ({c[11]})\n├ Status: {status_map.get(c[5], c[5])}\n├ Masalah: {c[4][:80]}\n"
        if c[6]:
            text += f"└ Catatan: {c[6]}\n"
        text += "\n"
    await query.edit_message_text(text, parse_mode='Markdown')

async def admin_panel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    if user_id not in ADMIN_IDS:
        await update.message.reply_text("❌ Akses ditolak.")
        return
    pending_topups = get_pending_topup_requests()
    pending_claims = get_pending_claims()
    text = f"""👑 *ADMIN PANEL*

📊 *STATISTIK*
━━━━━━━━━━━━━━━━━━━
💰 Top Up Pending: {len(pending_topups)}
🎫 Klaim Garansi Pending: {len(pending_claims)}

📜 *MANAJEMEN SCRIPT*
━━━━━━━━━━━━━━━━━━━
• /addscript - Tambah script
• /listscripts - Lihat script

🔧 *Command Admin:*
• /topupstats - Statistik top up
• /confirm [CODE] - Konfirmasi top up"""
    buttons = [
        [InlineKeyboardButton("💰 Konfirmasi Top Up", callback_data="admin_topup")],
        [InlineKeyboardButton("🎫 Proses Klaim Garansi", callback_data="admin_claims")],
        [InlineKeyboardButton("📜 Kelola Script", callback_data="admin_scripts")]
    ]
    await update.message.reply_text(text, parse_mode='Markdown', reply_markup=InlineKeyboardMarkup(buttons))

async def admin_topup_list(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    requests = get_pending_topup_requests()
    if not requests:
        await query.edit_message_text("📭 Tidak ada request top up pending.", parse_mode='Markdown')
        return
    text = "💰 *REQUEST TOP UP PENDING*\n\n"
    buttons = []
    for r in requests:
        text += f"┌ *{r['code']}*\n├ 👤 {r['full_name']} (@{r['username']})\n├ 💰 Rp {r['amount']:,}\n├ 💳 {r['method'].upper()}\n└ 📅 {datetime.now().strftime('%d/%m/%Y')}\n\n"
        buttons.append([InlineKeyboardButton(f"✅ Konfirmasi {r['code']}", callback_data=f"confirm_topup_{r['code']}")])
    buttons.append([InlineKeyboardButton("🔙 Kembali", callback_data="admin_panel")])
    await query.edit_message_text(text, parse_mode='Markdown', reply_markup=InlineKeyboardMarkup(buttons))

async def admin_confirm_topup(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    request_code = query.data.replace("confirm_topup_", "")
    admin_id = query.from_user.id
    success = confirm_topup(request_code, admin_id)
    if success:
        await query.edit_message_text(f"✅ Top up {request_code} telah dikonfirmasi. Saldo user bertambah.", parse_mode='Markdown')
    else:
        await query.edit_message_text("❌ Gagal konfirmasi. Request tidak ditemukan atau sudah diproses.", parse_mode='Markdown')

async def admin_claims_list(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    claims = get_pending_claims()
    if not claims:
        await query.edit_message_text("📭 Tidak ada klaim garansi pending.", parse_mode='Markdown')
        return
    text = "🎫 *KLAIM GARANSI PENDING*\n\n"
    for c in claims:
        text += f"┌ Klaim #{c['id']}\n├ 👤 {c['full_name']} (@{c['username']})\n├ 🎛️ {c['product_name']}\n├ 🆔 {c['warranty_code']}\n├ 📝 {c['issue_description'][:100]}\n└ 🔧 /resolve {c['id']}\n\n"
    await query.edit_message_text(text, parse_mode='Markdown')

async def admin_script_menu(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    text = """📜 *MANAJEMEN SCRIPT*

📋 *Command:*
• /addscript - Tambah script baru
• /listscripts - Lihat semua script

📝 *Format Tambah Script:*
`/addscript Nama|Deskripsi|Versi|Harga|Kategori`

Contoh:
`/addscript Auto Deposit|Script auto deposit|1.0.0|50000|payment`

Setelah itu, kirim file .zip"""
    await query.edit_message_text(text, parse_mode='Markdown')

async def addscript_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    if user_id not in ADMIN_IDS:
        await update.message.reply_text("❌ Akses ditolak.")
        return
    if not context.args:
        await update.message.reply_text("📝 *Tambah Script*\n\nFormat: `/addscript Nama|Deskripsi|Versi|Harga|Kategori`\n\nKemudian kirim file .zip", parse_mode='Markdown')
        return
    info = ' '.join(context.args).split('|')
    if len(info) != 5:
        await update.message.reply_text("❌ Format salah! Gunakan: Nama|Deskripsi|Versi|Harga|Kategori")
        return
    context.user_data['pending_script'] = {
        'name': info[0].strip(),
        'description': info[1].strip(),
        'version': info[2].strip(),
        'user_price': int(info[3].strip()),
        'category': info[4].strip()
    }
    await update.message.reply_text(f"✅ Info script diterima!\n\n📦 {info[0]} v{info[1]}\n💰 Harga User: Rp {int(info[3]):,}\n💰 Harga Reseller: Rp {int(int(info[3]) * 0.75):,}\n\n📤 Silakan kirim file script (.zip)")

async def handle_script_file(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    if user_id not in ADMIN_IDS:
        return
    pending = context.user_data.get('pending_script')
    if not pending:
        return
    if not update.message.document:
        await update.message.reply_text("❌ Kirim file script dalam format .zip")
        return
    document = update.message.document
    if not document.file_name.endswith('.zip'):
        await update.message.reply_text("❌ File harus berekstensi .zip!")
        return
    file = await context.bot.get_file(document.file_id)
    temp_path = f"temp_{document.file_name}"
    await file.download_to_drive(temp_path)
    success = script_storage.add_script(pending['name'], pending['description'], pending['version'], pending['user_price'], pending['category'], temp_path)
    os.remove(temp_path)
    if success:
        await update.message.reply_text(f"✅ Script {pending['name']} berhasil ditambahkan!", parse_mode='Markdown')
    else:
        await update.message.reply_text("❌ Gagal menambahkan script. Mungkin nama sudah ada.", parse_mode='Markdown')
    context.user_data.pop('pending_script', None)

async def listscripts_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    if user_id not in ADMIN_IDS:
        await update.message.reply_text("❌ Akses ditolak.")
        return
    scripts = script_storage.get_all_scripts()
    if not scripts:
        await update.message.reply_text("📭 Belum ada script.")
        return
    text = "📜 *DAFTAR SCRIPT*\n\n"
    for s in scripts:
        text += f"ID: {s['id']} | {s['name']} v{s['version']}\n├ User: Rp {s['user_price']:,}\n├ Reseller: Rp {s['reseller_price']:,}\n└ {s['category']}\n\n"
    await update.message.reply_text(text, parse_mode='Markdown')

async def main_menu(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    await start(update, context)

# ==================== MAIN ====================
def main():
    init_db()
    app = Application.builder().token(BOT_TOKEN).build()
    
    # Commands
    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("saldo", my_balance))
    app.add_handler(CommandHandler("topup", topup_menu))
    app.add_handler(CommandHandler("upgrade", upgrade_reseller))
    app.add_handler(CommandHandler("mydownline", my_downline))
    app.add_handler(CommandHandler("mycommission", my_commission))
    app.add_handler(CommandHandler("mypanels", my_panels))
    app.add_handler(CommandHandler("myscripts", my_scripts))
    app.add_handler(CommandHandler("download", download_script_command))
    app.add_handler(CommandHandler("admin", admin_panel))
    app.add_handler(CommandHandler("addscript", addscript_command))
    app.add_handler(CommandHandler("listscripts", listscripts_command))
    app.add_handler(MessageHandler(filters.Document.ALL, handle_script_file))
    
    # Callback queries
    app.add_handler(CallbackQueryHandler(beli_panel_menu, pattern="^beli_panel$"))
    app.add_handler(CallbackQueryHandler(pilih_ram, pattern="^pilih_ram_"))
    app.add_handler(CallbackQueryHandler(beli_script_menu, pattern="^beli_script$"))
    app.add_handler(CallbackQueryHandler(pilih_script, pattern="^pilih_script_"))
    app.add_handler(CallbackQueryHandler(checkout_script, pattern="^checkout_script_"))
    app.add_handler(CallbackQueryHandler(topup_menu, pattern="^topup$"))
    app.add_handler(CallbackQueryHandler(topup_nominal, pattern="^topup_\\d+$"))
    app.add_handler(CallbackQueryHandler(topup_custom, pattern="^topup_custom$"))
    app.add_handler(CallbackQueryHandler(topup_payment_method, pattern="^payment_"))
    app.add_handler(CallbackQueryHandler(upgrade_reseller, pattern="^upgrade_reseller$"))
    app.add_handler(CallbackQueryHandler(confirm_upgrade, pattern="^confirm_upgrade$"))
    app.add_handler(CallbackQueryHandler(menu_garansi, pattern="^menu_garansi$"))
    app.add_handler(CallbackQueryHandler(cek_garansi, pattern="^cek_garansi$"))
    app.add_handler(CallbackQueryHandler(klaim_garansi_form, pattern="^klaim_garansi$"))
    app.add_handler(CallbackQueryHandler(claim_select_warranty, pattern="^claim_select_"))
    app.add_handler(CallbackQueryHandler(claim_issue_selected, pattern="^claim_issue_"))
    app.add_handler(CallbackQueryHandler(status_klaim, pattern="^status_klaim$"))
    app.add_handler(CallbackQueryHandler(admin_topup_list, pattern="^admin_topup$"))
    app.add_handler(CallbackQueryHandler(admin_confirm_topup, pattern="^confirm_topup_"))
    app.add_handler(CallbackQueryHandler(admin_claims_list, pattern="^admin_claims$"))
    app.add_handler(CallbackQueryHandler(admin_script_menu, pattern="^admin_scripts$"))
    app.add_handler(CallbackQueryHandler(main_menu, pattern="^main_menu$"))
    
    # Message handlers
    app.add_handler(MessageHandler(filters.PHOTO, upload_topup_proof))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, process_custom_topup))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, process_claim_description))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, process_panel_name))
    
    logger.info("Bot started!")
    app.run_polling()

if __name__ == "__main__":
    main()