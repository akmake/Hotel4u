import os
import tkinter as tk
from tkinter import filedialog, messagebox
from datetime import datetime

# עומק מקסימלי
MAX_DEPTH = 7

# תיקיות שמותר לסרוק ברמה העליונה בלבד
ALLOWED_ROOT_DIRS = {"client", "server"}

# תיקיות שיש לדלג עליהן בתוך client/server
SKIP_DIRS = {
    "node_modules", ".git", "__pycache__", "package-lock.json",
    ".venv", ".wwebjs_cache", ".wwebjs_auth"
}

# קבצים שיש לדלג עליהם
SKIP_FILES = {
    "index-DEKCV7q4.js", "תיעוד", ".py"
}

# סיומות שמותר להציג
PRINT_CONTENT_EXTENSIONS = {".js", ".ts", ".html", ".css", ".jsx", ".md"}


def scan_directory(path, indent=0, output_lines=None, current_depth=0, print_content=False):
    if output_lines is None:
        output_lines = []

    # עומק מקסימלי
    if current_depth > MAX_DEPTH:
        output_lines.append("  " * indent + "🔽 ... (העומק הגיע למקסימום)")
        return output_lines

    try:
        items = sorted(os.listdir(path))
    except Exception as e:
        output_lines.append("  " * indent + f"[שגיאה בגישה]: {e}")
        return output_lines

    for item in items:
        full_path = os.path.join(path, item)

        # שלב 1: ברמה הראשונה, לא לסרוק שום דבר חוץ מ-client/server
        if indent == 0 and item not in ALLOWED_ROOT_DIRS:
            continue

        # שלב 2: דילוג על תיקיות אסורות
        if os.path.isdir(full_path) and item in SKIP_DIRS:
            output_lines.append("  " * indent + f"🚫 {item}/ (נפסל לסריקה)")
            continue

        # שלב 3: דילוג על קבצים אסורים
        if not os.path.isdir(full_path) and item in SKIP_FILES:
            output_lines.append("  " * indent + f"🚫 {item} (נפסל לסריקה)")
            continue

        # תיקייה רגילה
        if os.path.isdir(full_path):
            output_lines.append("  " * indent + f"📁 {item}/")
            scan_directory(full_path, indent + 1, output_lines, current_depth + 1, print_content)

        # קובץ
        else:
            ext = os.path.splitext(item)[1].lower()
            if ext not in PRINT_CONTENT_EXTENSIONS:
                continue

            output_lines.append("  " * indent + f"📄 {item}")

            if print_content:
                try:
                    with open(full_path, "r", encoding="utf-8", errors="ignore") as f:
                        for line in f:
                            output_lines.append("  " * (indent + 1) + line.rstrip())
                except Exception as e:
                    output_lines.append("  " * (indent + 1) + f"[שגיאה בקריאה: {e}]")

    return output_lines


def ask_include_content():
    root = tk.Tk()
    root.withdraw()
    result = messagebox.askyesno(
        "האם לכלול תוכן קבצים?",
        "לכלול את תוכן קבצי הקוד (ולא רק את שמותיהם)?"
    )
    root.destroy()
    return result


def write_to_two_locations(filename, lines, desktop_path, custom_path):
    output_file_desktop = os.path.join(desktop_path, filename)
    output_file_custom = os.path.join(custom_path, filename)

    # שמירה לשולחן עבודה
    with open(output_file_desktop, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    # שמירה לתיקייה שהגדרת
    with open(output_file_custom, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    return output_file_desktop, output_file_custom


def main():
    root = tk.Tk()
    root.withdraw()

    folder_path = filedialog.askdirectory(title="בחר תקייה לסריקה")
    if not folder_path:
        print("❌ לא נבחרה תקייה.")
        return

    include_content = ask_include_content()
    print(f"\n📂 סורק את: {folder_path}")

    # זמן לשמות קבצים
    timestamp = datetime.now().strftime("%d%m%y%H%M")

    # נתיבי שמירה
    desktop_path = os.path.join(os.path.expanduser("~"), "Desktop")
    custom_path = r"G:\האחסון שלי\update"

    # נבנה קבצים נפרדים ל-client ול-server (אם קיימים)
    outputs = []  # (label, desktop_file, custom_file)

    try:
        for root_dir in ["client", "server"]:
            target_path = os.path.join(folder_path, root_dir)
            if not os.path.isdir(target_path):
                continue

            lines = [f"📁 {root_dir}/"]
            scan_directory(target_path, indent=1, output_lines=lines, current_depth=0, print_content=include_content)

            filename = f"{root_dir}_{timestamp}.txt"
            out_desktop, out_custom = write_to_two_locations(
                filename=filename,
                lines=lines,
                desktop_path=desktop_path,
                custom_path=custom_path
            )
            outputs.append((root_dir, out_desktop, out_custom))

        if not outputs:
            messagebox.showwarning(
                "לא נמצא מה לשמור",
                "לא נמצאו תיקיות client או server בתוך התקייה שבחרת."
            )
            return

        print("\n📋 הסריקה הסתיימה. נשמרו קבצים:")
        msg_lines = ["הקבצים נשמרו בהצלחה:\n"]
        for label, out_desktop, out_custom in outputs:
            print(f"✅ {label}:")
            print(out_desktop)
            print(out_custom)
            msg_lines.append(f"{label}:\n{out_desktop}\n{out_custom}\n")

        messagebox.showinfo("הצלחה", "\n".join(msg_lines))

    except Exception as e:
        print(f"\n❌ שגיאה בשמירה: {e}")
        messagebox.showerror("שגיאה", f"לא הצלחתי לשמור את הקבצים:\n{e}")


if __name__ == "__main__":
    main()
