# Designing and Evaluating a Conversational Agent to Support End-of-Life Values Reflection

## 📘 Project Overview

This project explores how **Large Language Models (LLMs)** can be used to support individuals in **reflecting on their personal values and preferences** related to medical decision-making at the end of life.  
The ultimate goal is to **simplify and humanize the process of completing advance directives** — helping people express their wishes **before** they face critical health situations.

Rather than focusing on end-of-life counseling, this work aims to create an **early-stage reflection tool** that guides users through a **values-based conversation**. By asking open questions, rephrasing responses, and providing empathetic, neutral feedback, the conversational agent encourages deeper self-reflection without judgment or bias.

---

## 🎯 Objectives

- 🧭 Facilitate **early reflection** on personal priorities, beliefs, and values related to end-of-life care.  
- 🤖 Design a **LLM-powered conversational agent** capable of guiding users interactively through that reflection process.  
- 🩺 Bridge the gap between **static tools** (forms, videos, value cards) and **dynamic, personalized dialogue**.  
- 🧠 Evaluate the **ethical, clinical, and emotional safety** of AI-driven conversations on sensitive topics.  
- 🧩 Prepare the conceptual groundwork for **integrating reflection results** into future advance directive systems.

---

## 🧩 Project Tasks

1. **Context Familiarization**  
   Understand the ethical, clinical, and societal context of advance directives and end-of-life care.

2. **Reuse of Existing Materials**  
   Extract and adapt existing content developed in the prior project *Anticipatction* (e.g., reflection prompts, question sets).

3. **Prototype Development**  
   Configure an LLM-based conversational agent using **prompt engineering** and/or **lightweight fine-tuning**.

4. **Evaluation Methodology**  
   Define measures for **usability**, **acceptability**, and **ethical safety** (neutrality, emotional impact).

5. **User Testing**  
   Conduct user studies with simulated or real participants (e.g., students or volunteers) in controlled environments.

6. **Iteration and Improvement**  
   Refine conversation flow, clarity, engagement, and robustness based on user feedback.

---

## 💬 Conversational Approach

| Principle | Description |
|------------|--------------|
| **Empathy without intrusion** | The agent listens and reflects without judging or steering opinions. |
| **Value clarification** | Helps users identify what matters most (e.g., autonomy, comfort, dignity). |
| **Transparency** | Users understand how and why the model responds the way it does. |
| **Emotional safety** | Sensitive topics are handled with care and appropriate disclaimers. |

---

## ⚙️ Technical Overview

| Component | Description |
|------------|--------------|
| **LLM Core** | A GPT-based or LLaMA-based model configured for open-ended reflection dialogue. |
| **Prompt Layer** | Custom prompt structure to elicit values-oriented and neutral conversation. |
| **Frontend Prototype** | Simple chat or voice interface for guided interaction. |
| **Technical Modules used:** | Next.js (React), Tailwind CSS, FastAPI, OpenAI Whisper (Speech Encoding/Decoding) |
| **Evaluation Framework** | Metrics for usability (SUS), emotional impact, and ethical safety. |

---

## 🧠 Ethical Considerations

- Respect user autonomy and emotional boundaries.  
- Ensure that conversations **inform** but never **replace** professional counseling or medical advice.  
- No storage of personal or identifiable data without explicit consent.  
- Emphasis on **transparency, neutrality, and emotional comfort**.

---

## 🚀 Getting Started

### Running the Application for Usability Testing

For quick setup and running the full-stack application (frontend + backend), see the **[Usability Testing Guide](eol-chat-starter/USABILITY_TESTING.md)**.

**Quick Start (Windows):**
```powershell
cd eol-chat-starter
.\start.ps1
```

**Quick Start (Mac/Linux):**
```bash
cd eol-chat-starter
npm run install:all
npm start
```

The application will be available at:
- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:8787

### Development Setup

```bash
# Clone repository
git clone https://gitlab.ti.bfh.ch/chand2/lc1-end-of-life-reflection.git
cd lc1-end-of-life-reflection

# Optional: setup environment
python -m venv venv
source venv/bin/activate    # or venv\Scripts\activate on Windows
pip install -r requirements.txt
```

Run the prototype (example):
```bash
python run_agent.py
```

---

## 🧪 Evaluation Plan

| Dimension | Method |
|------------|---------|
| **Usability** | System Usability Scale (SUS) questionnaire |
| **Acceptability** | User interviews and post-session surveys |
| **Ethical Safety** | Observation and qualitative feedback on emotional comfort |
| **Neutrality** | Analysis of linguistic bias in model responses |

---

## 🏗️ Future Work

- Integration of **voice-based interactions** for accessibility and realism.  
- Development of a **web or mobile interface** for real-world usability testing.  
- Expansion of evaluation with **clinical experts and ethicists**.  
- Potential deployment in **educational or healthcare settings**.

---

## 👥 Authors

**Denis Chanmongkhon**  **Ayaka Hara** 
Bern University of Applied Sciences (BFH)  
Module BTX8202: LC1 – End of Life Reflection  
Supervisor: *Kerstin Denecke*

---

## 📜 License

This project is part of the BFH LC1 module.  
For academic and research purposes only.

---

## 📈 Project Status

| Milestone | Status |
|------------|---------|
| Context & literature review | ✅ Completed |
| Prototype concept | ✅ Defined |
| Conversational prototype | 🔧 In progress |
| Evaluation plan | 🔧 In progress |
| User study & refinement | ⏳ Upcoming |
