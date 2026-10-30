// API Keys Management System for AFG AI
// این فایل مدیریت کلیدهای API را از GitHub Secrets یا پنل کاربری انجام می‌دهد

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Path to store encrypted API keys (for panel-based management)
const KEYS_FILE = path.join(__dirname, '.api-keys.json');

// Encryption key from environment (must be set in production)
const ENCRYPTION_KEY = process.env.API_ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');

class ApiKeysManager {
  constructor() {
    this.keys = new Map();
    this.loadKeys();
  }

  // Load keys from file or environment
  loadKeys() {
    // Priority 1: Environment variables (GitHub Secrets / Render)
    const envKeys = {
      claude: process.env.LLMSRELAY_CLAUDE_API_KEY,
      codex: process.env.LLMSRELAY_CODEX_API_KEY,
      uncensored: process.env.LLMSRELAY_UNCENSORED_API_KEY,
      tavily: process.env.TAVILY_API_KEY,
      image: process.env.IMAGE_API_KEY,
      openai: process.env.OPENAI_API_KEY,
      anthropic: process.env.ANTHROPIC_API_KEY
    };

    Object.entries(envKeys).forEach(([group, key]) => {
      if (key) {
        this.keys.set(group, { key, source: 'environment' });
      }
    });

    // Priority 2: Encrypted file (panel management)
    if (fs.existsSync(KEYS_FILE)) {
      try {
        const encrypted = fs.readFileSync(KEYS_FILE, 'utf8');
        const decrypted = this.decrypt(encrypted);
        const fileKeys = JSON.parse(decrypted);
        
        Object.entries(fileKeys).forEach(([group, key]) => {
          if (key && !this.keys.has(group)) {
            this.keys.set(group, { key, source: 'panel' });
          }
        });
      } catch (error) {
        console.error('Failed to load API keys from file:', error.message);
      }
    }
  }

  // Get API key for a specific group
  getKey(group) {
    const entry = this.keys.get(group);
    return entry ? entry.key : null;
  }

  // Check if a group has a configured key
  hasKey(group) {
    return this.keys.has(group) && Boolean(this.keys.get(group).key);
  }

  // Get all configured groups
  getConfiguredGroups() {
    return Array.from(this.keys.keys());
  }

  // Get key metadata (without exposing the actual key)
  getKeyInfo(group) {
    const entry = this.keys.get(group);
    if (!entry) return null;
    
    const masked = entry.key.slice(0, 8) + '...' + entry.key.slice(-4);
    return {
      group,
      masked,
      source: entry.source,
      configured: true
    };
  }

  // Add or update a key (panel management)
  setKey(group, key, adminPassword) {
    // Verify admin password
    const correctPassword = process.env.ADMIN_PASSWORD || 'change-me-in-production';
    if (adminPassword !== correctPassword) {
      throw new Error('Unauthorized: Invalid admin password');
    }

    if (!key || typeof key !== 'string') {
      throw new Error('Invalid API key');
    }

    this.keys.set(group, { key, source: 'panel' });
    this.saveKeys();
    return { success: true, group, masked: key.slice(0, 8) + '...' + key.slice(-4) };
  }

  // Remove a key (panel management)
  removeKey(group, adminPassword) {
    const correctPassword = process.env.ADMIN_PASSWORD || 'change-me-in-production';
    if (adminPassword !== correctPassword) {
      throw new Error('Unauthorized: Invalid admin password');
    }

    const entry = this.keys.get(group);
    if (entry && entry.source === 'environment') {
      throw new Error('Cannot remove environment-configured keys. Update GitHub Secrets or Render Environment.');
    }

    this.keys.delete(group);
    this.saveKeys();
    return { success: true, group };
  }

  // Save panel keys to encrypted file
  saveKeys() {
    const panelKeys = {};
    this.keys.forEach((entry, group) => {
      if (entry.source === 'panel') {
        panelKeys[group] = entry.key;
      }
    });

    const encrypted = this.encrypt(JSON.stringify(panelKeys));
    fs.writeFileSync(KEYS_FILE, encrypted, 'utf8');
  }

  // Encrypt data
  encrypt(text) {
    const iv = crypto.randomBytes(16);
    const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  }

  // Decrypt data
  decrypt(text) {
    const parts = text.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];
    const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  // Get all keys status for admin panel
  getAllKeysStatus() {
    const status = {};
    const allGroups = ['claude', 'codex', 'uncensored', 'tavily', 'image', 'openai', 'anthropic'];
    
    allGroups.forEach(group => {
      if (this.hasKey(group)) {
        status[group] = this.getKeyInfo(group);
      } else {
        status[group] = {
          group,
          configured: false,
          source: null
        };
      }
    });

    return status;
  }
}

// Singleton instance
const apiKeysManager = new ApiKeysManager();

module.exports = apiKeysManager;
