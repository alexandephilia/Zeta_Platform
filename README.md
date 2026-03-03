# 🌌 Zeta AI Assistant

A high-performance, multi-model AI chat assistant with real-time web search capabilities. Built with **React 19** and **TypeScript** for a seamless, intelligent experience.

![Zeta AI](https://img.shields.io/badge/React-19-blue?style=for-the-badge&logo=react) ![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue?style=for-the-badge&logo=typescript) ![Vite](https://img.shields.io/badge/Vite-6-purple?style=for-the-badge&logo=vite)

![Zeta Platform Screenshot](https://i.ibb.co/4wRhmGv0/Screen-Shot-2026-03-03-at-21-55-48-PM.png)

---

> [!IMPORTANT]
> This project requires several API keys to function. Ensure you have access to Google AI Studio, Groq, OpenRouter, and Exa before proceeding.

## ✨ Features

### 🤖 Multi-Model Intelligence

- **Gemini 3 Flash/Pro**: Google's cutting-edge models with native reasoning and tool execution.
- **Kimi K2**: Blazing fast inference via Groq, augmented with Exa search tools.
- **Groq Compound**: Enterprise-grade capabilities including native web search, code execution, and Wolfram Alpha integration.
- **DeepSeek V3.1**: Efficient reasoning via OpenRouter.

### 🧠 Advanced Capabilities

- 🔍 **Exa Web Search**: Real-time information retrieval with precise source citations.
- 💭 **Chain of Thought**: Visualize the model's reasoning process in real-time.
- 📁 **Universal File Support**: Seamlessly context-inject images, PDFs, Word docs, and Excel sheets.
- 📜 **Chat Persistence**: Locally stored conversation history.
- 🌊 **Smooth Streaming**: Optimized token delivery with animated markdown.

### 🎨 Premium UI/UX

- **Claymorphism Design**: Modern, depth-driven aesthetics.
- **Framer Motion**: Fluid transitions and micro-animations.
- **Flowtoken Rendering**: Gorgeous, animated markdown output.
- **Search Timeline**: Detailed search journey with integrated image galleries.

---

## 🚀 Quick Start

### 📋 Prerequisites

- **Node.js**: version 18 or higher.
- **Package Manager**: `npm` or `yarn`.

### 📥 Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/zeta-ai.git
cd zeta-ai

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Open .env and insert your secrets
```

### ⚙️ Environment Configuration

> [!WARNING]
> Never commit your `.env` file to version control.

| Variable                  | Source                                             | Description                   |
| :------------------------ | :------------------------------------------------- | :---------------------------- |
| `VITE_GEMINI_API_KEY_1`   | [AI Studio](https://aistudio.google.com/apikey)    | Primary Google Gemini Key     |
| `VITE_GROQ_API_KEY`       | [Groq Console](https://console.groq.com/keys)      | Groq API access               |
| `VITE_OPENROUTER_API_KEY` | [OpenRouter](https://openrouter.ai/keys)           | Access to DeepSeek and others |
| `VITE_EXA_API_KEY`        | [Exa Dashboard](https://dashboard.exa.ai/api-keys) | Web search capability         |

---

## 🏗️ Project Architecture

```text
├── components/
│   ├── atoms/       # Foundation (buttons, inputs, icons)
│   ├── molecules/   # Compounds (message bubbles, cards)
│   ├── organisms/   # Complex structures (sidebar, input)
│   └── templates/   # Full page layouts
├── services/        # API integrations (Gemini, Groq, Exa)
├── hooks/           # Logic & state management
└── types.ts         # Global Type Definitions
```

---

## 📊 Model Matrix

| Model              | Provider   | Web Search | Thinking  | Multi-modal | Cost      |
| :----------------- | :--------- | :--------- | :-------- | :---------- | :-------- |
| **Gemini 3 Flash** | Google     | ✅ Exa     | ✅ Native | ✅          | Paid      |
| **Gemini 3 Pro**   | Google     | ✅ Exa     | ✅ Native | ✅          | Paid      |
| **Kimi K2**        | Groq       | ✅ Exa     | ✅ Tags   | ❌          | Free Tier |
| **Compound**       | Groq       | ✅ Native  | ❌        | ❌          | Free Tier |
| **DeepSeek V3.1**  | OpenRouter | ✅ Exa     | ✅ Tags   | ❌          | Free Tier |

---

## 📜 Credits & License

> [!NOTE] > **Copyright © 2024 Alexandephilia**. All rights reserved.
> Created and maintained by Alexandephilia with coffee

This project is licensed under the **MIT License**.
