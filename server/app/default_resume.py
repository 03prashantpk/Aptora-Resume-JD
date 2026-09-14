"""The default résumé LaTeX the editor loads on first open (the pivot).

This is real, working LaTeX that compiles under Tectonic offline (verified). It is the
"render full original by default" starting point. Users/AI edit it freely from here.

All content is FICTIONAL sample data (no real person). Placeholder identity, company,
schools and links use example.com so nothing is tied to a real individual."""

DEFAULT_RESUME_TEX = r"""\documentclass[a4paper,11pt]{article}
\usepackage[margin=0.65in,top=0.45in,bottom=0.45in]{geometry}
\usepackage{enumitem}
\usepackage[hidelinks]{hyperref}
\usepackage{titlesec}
\usepackage{parskip}
\usepackage{xcolor}
\usepackage{newtxtext,newtxmath} % Cambria-like serif font
\pagenumbering{gobble}
\usepackage{tabularx}
\usepackage{ragged2e}
% ---------- Section Formatting ----------
\titleformat{\section}
  {\Large\bfseries\uppercase}
  {}{0em}{}[\titlerule]
\setlist[itemize]{noitemsep, topsep=4pt, left=8pt}
\setlength{\parskip}{4pt}
\renewcommand{\baselinestretch}{1.12}
\begin{document}
% ======= Header =========
\vspace*{-5pt}
\begin{center}
    {\Huge \textbf{ALEX CARTER}}\\[5pt]
    {\large\textbf{FULL-STACK DEVELOPER}}\\[9pt]
    \normalsize
    \textbullet\ +1 (555) 010-2020 \textbullet\
    \href{mailto:alex.carter@example.com}{alex.carter@example.com} \textbullet\
    \href{https://linkedin.com/in/alexcarter}{linkedin.com/in/alexcarter} \textbullet\
    \href{https://github.com/alexcarter}{github.com/alexcarter}
\end{center}
% ======= Summary =========
\section*{SUMMARY}
Determined full-stack developer skilled in MERN Stack and Next.js, with hands-on experience deploying scalable solutions on AWS, Firebase, and DigitalOcean. Proficient in PostgreSQL, MySQL, MongoDB, Django, Python, and PHP, with a focus on designing secure, high-performing applications that integrate AI, SEO, and AEO---giving apps and websites the power to think. Passionate about delivering solutions that balance performance, scalability, and security while maintaining clean code, thorough documentation, and user-focused digital experiences.
% ======= Experience =========
\section*{EXPERIENCE}
\textbf{Full-Stack Developer --- Northwind Web Studio} \hfill \textit{May 2024 -- Present}
\begin{itemize}
    \item Designed and deployed full-stack solutions using React.js, Next.js, Tailwind CSS, and Django/PHP for robust, responsive web applications; built and maintained backend systems using Node.js, Express.js, and Python with PostgreSQL and MongoDB for scalable data management.
    \item Automated CI/CD pipelines using GitHub Actions and Docker, deploying to AWS (EC2, Lambda, S3, and RDS).
    \item Worked extensively with Meta App APIs (Facebook, Instagram, and WhatsApp via Graph API Explorer) for automation, analytics, and marketing workflows.
    \item Integrated and developed data pipelines with LinkedIn API, YouTube API, Bluesky API, and TikTok API to enhance cross-platform automation and insights.
    \item Collaborated with clients on requirements, documentation, and structured change control processes to ensure efficient delivery and maintain code quality.
\end{itemize}
\vspace{5pt}
\textbf{Key Projects}
\begin{itemize}
    \item \textbf{Consentz --- Meta Marketing Tool:} Ad creation \& automation (budgets, scheduling), performance tracking, and post generation. Provides ad insights, demographic analytics, and campaign controls using FB Graph API. \href{https://example.com/consentz}{Link}
    \item \textbf{Adrigo Insights --- Social Media Insights Tool AI:} Cross-platform performance analysis (Facebook, Instagram, YouTube, LinkedIn, BlueSky, TikTok) with trend forecasting using historical data and AI. Stripe Payment gateway integration. \href{https://example.com/adrigo}{Link}
    \item \textbf{Zapify --- Instagram Automation:} AI-powered Instagram comment management and automation platform that replies to comments in your own voice using AI, saving 5+ hours weekly with personalized and authentic responses. \href{https://example.com/zapify}{Link}
\end{itemize}
% ======= Projects =========
\section*{PROJECTS}
\begin{itemize}
    \item \textbf{UniChatApp --- University Community \& Android App} \hfill \textit{MERN, Firebase, Socket.io} \\
    Real-time chat app with secure messaging, multimedia sharing, music discovery, and anonymous ``Confessions.'' Supports group creation, news feeds, organization management, and student-focused dating. Built for university engagement. \href{https://example.com/unichat}{Link}

    \item \textbf{NightHawk --- Bookmark App, AI Semantic Search} \hfill \textit{Next.js, AWS S3, Firebase Auth} \\
    Intelligent bookmarking platform supporting public/private/viral collections with AI-powered search and automated metadata extraction using Microlink and OpenAI API. Includes Next.js API routes, Firebase Auth, S3 storage, and an analytics dashboard. \href{https://example.com/nighthawk}{Link}

    \item \textbf{TeamSync --- Team Management Platform \& Slack Integration} \hfill \textit{SERN, Tailwind, SQL} \\
    Organization tool with team onboarding, project assignment, real-time analytics (coding time, active machines, work stats), role-based access, and leave management. Responsive dark/light UI with Tailwind CSS. \href{https://example.com/teamsync}{Link}
\end{itemize}
% ======= Technical Skills =========
\section*{TECHNICAL SKILLS}
\noindent
\textbf{Programming \& Development:} C++, Java, PHP, React.js, Next.js, Vue.js, Node.js, Express.js, Django, Flask, TypeScript, Tailwind CSS, Zustand, Redux, HTML5, SCSS \\[5pt]
\textbf{Cloud, Database \& DevOps:} AWS, Docker, DigitalOcean, CI/CD (GitHub Actions), MongoDB, PostgreSQL, Redis, SQL, Firebase, Microservices, WebSockets, Authentication, Security \\[5pt]
\textbf{AI, APIs \& Integrations:} ChatGPT API, Claude API, Gemini API, Hugging Face, Stability AI, Midjourney, Leonardo AI, Fal.ai, TensorFlow, REST, GraphQL, Postman, Third-Party API Integrations
% ======= Education =========
\section*{EDUCATION}
\begin{tabularx}{\textwidth}{@{}Xr@{}}
Bachelor of Technology (CSE) --- Northwood State University & 2020--2024 \\
Higher Secondary (12th PCM) --- Riverside Senior Secondary School & 2018--2020 \\
CBSE Class 10 --- Greenfield Public School & 2016--2017 \\
\end{tabularx}
% ======= Certifications =========
\section*{CERTIFICATIONS}
Backend Development --- Online Academy \textbullet\
React.js Placement Training --- CodeCampus \textbullet\
Hackathon Participant --- University Tech Fest \textbullet\
Database Management System --- Learning Platform
% ======= Soft Skills =========
\section*{SOFT SKILLS \& INTERESTS}
Adaptable \textbullet\ Teamwork \textbullet\ Collaboration \textbullet\ Problem Solving \textbullet\ AI Enthusiast \textbullet\ Reading \textbullet\ Tech Exploration
\vspace{12pt}
\begin{center}
    \href{https://example.com/portfolio}{\textbf{MORE PROJECTS \& PORTFOLIO: example.com/portfolio}}
\end{center}
\end{document}
"""
