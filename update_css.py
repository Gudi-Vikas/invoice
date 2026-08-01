import re

file_path = "frontend/src/index.css"

with open(file_path, "r") as f:
    content = f.read()

# Replace colors
content = content.replace("#234a75", "var(--doc-accent, #234a75)")
content = content.replace("#355a82", "color-mix(in srgb, var(--doc-accent, #234a75) 85%, white)")

# Append Theme Styles
theme_styles = """

/* =========================================================
   INVOICE THEMES
   ========================================================= */

/* Default Theme is handled by the base CSS above. */

/* --- Simple Theme --- */
.theme-simple {
  font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif !important;
}
.theme-simple .invoice-title-banner,
.theme-simple .invoice-address-header,
.theme-simple .invoice-address-body,
.theme-simple .invoice-total-due-banner,
.theme-simple .invoice-table th,
.theme-simple .invoice-footer-line {
  background-color: transparent !important;
  color: var(--text-primary) !important;
  border-radius: 0 !important;
}
.theme-simple .invoice-title-banner {
  color: var(--doc-accent, #234a75) !important;
  font-size: 2rem !important;
  text-align: right !important;
  padding: 0 !important;
}
.theme-simple .invoice-address-block {
  border: none !important;
  border-left: 3px solid var(--doc-accent, #234a75) !important;
  border-radius: 0 !important;
}
.theme-simple .invoice-address-header {
  padding: 0 0.8rem 0.2rem 0.8rem !important;
  color: var(--text-secondary) !important;
}
.theme-simple .invoice-address-body {
  padding: 0 0.8rem !important;
}
.theme-simple .invoice-table th {
  border-bottom: 2px solid var(--text-primary) !important;
  color: var(--text-primary) !important;
}
.theme-simple .invoice-total-due-banner {
  border-top: 2px solid var(--text-primary) !important;
  border-bottom: 2px solid var(--text-primary) !important;
  padding: 1rem 0 !important;
  margin-top: 1rem !important;
}

/* --- Modern Theme --- */
.theme-modern {
  font-family: 'Outfit', sans-serif !important;
}
.theme-modern .invoice-title-banner {
  background-color: transparent !important;
  color: var(--doc-accent, #234a75) !important;
  font-size: 2.5rem !important;
  text-align: right !important;
  padding: 0 !important;
  letter-spacing: -0.02em !important;
}
.theme-modern .invoice-address-block {
  border: none !important;
  background-color: #f8fafc !important;
  border-radius: 12px !important;
  padding: 1rem !important;
}
.theme-modern .invoice-address-header {
  background-color: transparent !important;
  color: var(--doc-accent, #234a75) !important;
  padding: 0 0 0.5rem 0 !important;
  border-bottom: 1px solid #e2e8f0 !important;
  margin-bottom: 0.5rem !important;
}
.theme-modern .invoice-address-body {
  background-color: transparent !important;
  color: var(--text-primary) !important;
  padding: 0 !important;
}
.theme-modern .invoice-table {
  border-collapse: separate !important;
  border-spacing: 0 0.5rem !important;
}
.theme-modern .invoice-table th {
  background-color: transparent !important;
  color: var(--text-secondary) !important;
  border: none !important;
}
.theme-modern .invoice-table td {
  background-color: #f8fafc !important;
  border: none !important;
}
.theme-modern .invoice-table td:first-child { border-radius: 8px 0 0 8px !important; }
.theme-modern .invoice-table td:last-child { border-radius: 0 8px 8px 0 !important; }

/* --- Bold Theme --- */
.theme-bold {
  font-family: 'Roboto', sans-serif !important;
  border: 8px solid var(--doc-accent, #234a75) !important;
  padding: 3rem !important;
}
.theme-bold .invoice-header {
  border-bottom: 4px solid var(--doc-accent, #234a75) !important;
  padding-bottom: 1rem !important;
}
.theme-bold .invoice-title-banner {
  background-color: var(--doc-accent, #234a75) !important;
  color: #fff !important;
  font-size: 2rem !important;
  padding: 1rem 2rem !important;
}
.theme-bold .invoice-address-block {
  border: 2px solid var(--doc-accent, #234a75) !important;
}
.theme-bold .invoice-table th {
  background-color: var(--doc-accent, #234a75) !important;
  color: #fff !important;
  font-weight: 900 !important;
}
.theme-bold .invoice-total-due-banner {
  background-color: var(--doc-accent, #234a75) !important;
  color: #fff !important;
  padding: 1.5rem !important;
  font-size: 1.5rem !important;
}

/* --- Elegant Theme --- */
.theme-elegant {
  font-family: 'Georgia', serif !important;
  color: #333 !important;
}
.theme-elegant .invoice-title-banner {
  background-color: transparent !important;
  color: var(--doc-accent, #234a75) !important;
  font-size: 2.5rem !important;
  text-align: center !important;
  padding: 0 !important;
  letter-spacing: 0.1em !important;
  border-bottom: 1px solid var(--doc-accent, #234a75) !important;
  border-top: 1px solid var(--doc-accent, #234a75) !important;
  padding: 1rem 0 !important;
}
.theme-elegant .invoice-address-block {
  border: none !important;
}
.theme-elegant .invoice-address-header {
  background-color: transparent !important;
  color: var(--doc-accent, #234a75) !important;
  padding: 0 !important;
  border-bottom: 1px dashed #ccc !important;
  margin-bottom: 0.5rem !important;
}
.theme-elegant .invoice-address-body {
  background-color: transparent !important;
  color: #555 !important;
  padding: 0 !important;
}
.theme-elegant .invoice-table th {
  background-color: transparent !important;
  color: var(--doc-accent, #234a75) !important;
  border-top: 2px solid var(--doc-accent, #234a75) !important;
  border-bottom: 2px solid var(--doc-accent, #234a75) !important;
}
.theme-elegant .invoice-total-due-banner {
  background-color: transparent !important;
  color: var(--doc-accent, #234a75) !important;
  border-top: 2px solid var(--doc-accent, #234a75) !important;
  border-bottom: 2px double var(--doc-accent, #234a75) !important;
  padding: 1rem 0 !important;
}
.theme-elegant .invoice-footer-line {
  background-color: transparent !important;
  color: var(--text-secondary) !important;
  border-top: 1px dashed #ccc !important;
}
"""

with open(file_path, "w") as f:
    f.write(content + theme_styles)

print("CSS updated.")
