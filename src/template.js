export const documentTemplate = String.raw`\documentclass[12pt,a4paper]{article}

% Русский язык и математические пакеты
\usepackage[T2A]{fontenc}
\usepackage[utf8]{inputenc}
\usepackage[russian]{babel}
\usepackage{amsmath,amssymb,mathtools}
\usepackage{graphicx,xcolor}
\usepackage[margin=2cm]{geometry}
\usepackage{enumitem}
\usepackage{microtype}

\begin{document}

\section{Задача}

Условие задачи.

\subsection{Решение}

\begin{gather*}

\end{gather*}

\textbf{Ответ.}

\end{document}
`;
export const startPosition = documentTemplate.indexOf('\n\n\\end{gather*}') + 1;
