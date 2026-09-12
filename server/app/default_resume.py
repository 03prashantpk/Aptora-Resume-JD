"""The default résumé LaTeX the editor loads on first open (the pivot).

This is real, working LaTeX that compiles under Tectonic offline (verified). It is the
"render full original by default" starting point. Users/AI edit it freely from here."""

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
    {\Huge \textbf{PRASHANT KUMAR}}\\[5pt]
    {\large\textbf{FULL-STACK DEVELOPER}}\\[9pt]
    \normalsize
    \textbullet\ +91 9612096180 \textbullet\
    \href{mailto:prashantmanwan@gmail.com}{prashantmanwan@gmail.com} \textbullet\
    \href{https://linkedin.com/in/03prashantpk}{linkedin.com/in/03prashantpk} \textbullet\
    \href{https://github.com/03prashantpk}{github.com/03prashantpk}
\end{center}
% ======= Summary =========
\section*{SUMMARY}
Determined full-stack developer skilled in MERN Stack and Next.js, with hands-on experience deploying scalable solutions on AWS, Firebase, and DigitalOcean. Proficient in PostgreSQL, MySQL, MongoDB, Django, Python, and PHP, with a focus on designing secure, high-performing applications that integrate AI, SEO, and AEO---giving apps and websites the power to think. Passionate about delivering solutions that balance performance, scalability, and security while maintaining clean code, thorough documentation, and user-focused digital experiences.
% ======= Experience =========
\section*{EXPERIENCE}
\textbf{Full-Stack Developer --- Mojo Web Technology} \hfill \textit{May 2024 -- Present}
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
    \item \textbf{Consentz --- Meta Marketing Tool:} Ad creation \& automation (budgets, scheduling), performance tracking, and post generation. Provides ad insights, demographic analytics, and campaign controls using FB Graph API. \href{https://ads.mojowebtech.com/}{Link}
    \item \textbf{Adrigo Insights --- Social Media Insights Tool AI:} Cross-platform performance analysis (Facebook, Instagram, YouTube, LinkedIn, BlueSky, TikTok) with trend forecasting using historical data and AI. Stripe Payment gateway integration. \href{https://dashboard.adrigoinsights.com/}{Link}
    \item \textbf{Zapify.pro:} AI-powered Instagram comment management and automation platform that replies to comments in your own voice using AI, saving 5+ hours weekly with personalized and authentic responses. \href{https://zapify.pro}{Link}
\end{itemize}
% ======= Projects =========
\section*{PROJECTS}
\begin{itemize}
    \item \textbf{UniChatApp --- University Community \& Android App} \hfill \textit{MERN, Firebase, Socket.io} \\
    Real-time chat app with secure messaging, multimedia sharing, music discovery, and anonymous ``Confessions.'' Supports group creation, news feeds, organization management, and student-focused dating. Built for university engagement. \href{https://unichatapp.enally.in}{Link}

    \item \textbf{NightHawk --- Bookmark App, AI Semantic Search} \hfill \textit{Next.js, AWS S3, Firebase Auth} \\
    Intelligent bookmarking platform supporting public/private/viral collections with AI-powered search and automated metadata extraction using Microlink and OpenAI API. Includes Next.js API routes, Firebase Auth, S3 storage, and an analytics dashboard. \href{https://bookmark.enally.in}{Link}

    \item \textbf{TeamSync --- Team Management Platform \& Slack Integration} \hfill \textit{SERN, Tailwind, SQL} \\
    Organization tool with team onboarding, project assignment, real-time analytics (coding time, active machines, work stats), role-based access, and leave management. Responsive dark/light UI with Tailwind CSS. \href{https://teams-sync.mojowebtech.com}{Link}
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
Bachelor of Technology (CSE) --- Lovely Professional University, Punjab & 2020--2024 \\
Higher Secondary (12th PCM) --- St. John's Senior Sec. School, Rajasthan & 2018--2020 \\
CBSE Class 10 --- Assam Rifles Public School, Nagaland & 2016--2017 \\
\end{tabularx}
% ======= Certifications =========
\section*{CERTIFICATIONS}
Backend Development --- Board Infinity \textbullet\
React.js Placement Training --- CipherSchool \textbullet\
TECH-A-THON Participant --- iNeuron (LPU) \textbullet\
Database Management System --- Infosys Springboard
% ======= Soft Skills =========
\section*{SOFT SKILLS \& INTERESTS}
Adaptable \textbullet\ Teamwork \textbullet\ Collaboration \textbullet\ Problem Solving \textbullet\ AI Enthusiast \textbullet\ Reading \textbullet\ Tech Exploration
\vspace{12pt}
\begin{center}
    \href{https://prashant.enally.in}{\textbf{MORE PROJECTS \& PORTFOLIO: https://prashant.enally.in}}
\end{center}
\end{document}
"""
