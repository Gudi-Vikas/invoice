import os

def fix_file(path):
    with open(path, 'r') as f:
        content = f.read()
    
    # Replace \` with `
    content = content.replace('\\`', '`')
    # Replace \$ with $
    content = content.replace('\\$', '$')
    
    with open(path, 'w') as f:
        f.write(content)

fix_file('/home/vikas/Desktop/mern_projects/invoice/backend/controllers/documentController.js')
fix_file('/home/vikas/Desktop/mern_projects/invoice/backend/controllers/masterAdminController.js')
