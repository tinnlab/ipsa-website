// mermaidCode.js - Mermaid source normalization shared by the on-screen diagram component
// and the PDF/Word exporters. Moved out of the AIForm utils module so the exporters do not
// have to import React or the mermaid runtime. Unchanged from its previous home.

// Normalize Unicode characters for Mermaid compatibility
export const normalizeMermaidCode = (code) => {
    if (!code) return '';

    // First pass: normalize Unicode
    let normalized = code
        // Non-breaking hyphens and dashes
        .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015]/g, '-')
        // Special spaces
        .replace(/[\u00A0\u202F\u2007]/g, ' ')
        // Arrows
        .replace(/→/g, '->')
        .replace(/←/g, '<-')
        .replace(/↑/g, '^')
        .replace(/↓/g, 'v')
        // Remove zero-width characters
        .replace(/[\u200B\u200C\u200D\uFEFF\uFE0F]/g, '')
        // Replace any remaining non-ASCII characters that might cause parse errors
        // Keep only basic ASCII printable + newlines/tabs
        .replace(/[^\x20-\x7E\n\r\t]/g, '');

    // Second pass: fix parentheses inside node labels (Mermaid parser issue)
    // Replace () with - inside [...] node labels to avoid parser confusion
    normalized = normalized.replace(/\[([^\]]*)\]/g, (match, content) => {
        // Replace parentheses with spaces inside node labels
        const fixed = content.replace(/\(/g, ' ').replace(/\)/g, ' ');
        return `[${fixed}]`;
    });

    return normalized;
};
