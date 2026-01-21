# Field Property Bali - CRM System

A modern, mobile-first CRM built for Field Property Bali to manage leads, projects, suppliers, and activities.

![Field Property](https://static.wixstatic.com/media/7a1d36_36c3cf7d9a5f4f548060d7d66e20c60c~mv2.png)

## 🏗️ Tech Stack

- **React 18** - UI framework
- **Vite** - Build tool
- **Tailwind CSS** - Styling
- **React Router** - Navigation
- **Lucide React** - Icons

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

## 📁 Project Structure

```
field-crm/
├── src/
│   ├── components/
│   │   └── Layout.jsx       # Main layout with sidebar
│   ├── data/
│   │   └── index.js         # All data (projects, leads, etc.)
│   ├── pages/
│   │   ├── Dashboard.jsx    # Overview dashboard
│   │   ├── Pipeline.jsx     # Lead pipeline kanban
│   │   ├── Projects.jsx     # Projects list
│   │   ├── ProjectDetail.jsx # Single project view
│   │   ├── Suppliers.jsx    # Supplier management
│   │   ├── Materials.jsx    # Material orders
│   │   ├── Documents.jsx    # Document library
│   │   └── Activities.jsx   # Task management
│   ├── App.jsx
│   ├── main.jsx
│   └── index.css
├── tailwind.config.js
├── vite.config.js
└── package.json
```

## 🎨 Brand Colors

```css
--field-black: #1a1a1a
--field-gold: #c9a87c
--field-gold-dark: #b8860b
--field-stone: #78716c
--field-cream: #fafafa
```

## 📱 Features

- ✅ Mobile-responsive design
- ✅ Lead pipeline with drag-drop ready structure
- ✅ Project management with unit tracking
- ✅ ROI calculator display
- ✅ Supplier database
- ✅ Activity/task management
- ✅ WhatsApp integration
- ✅ Document library

## 🔧 Customization

### Adding New Projects
Edit `src/data/index.js` and add to the `projects` array.

### Adding New Leads
Edit `src/data/index.js` and add to the `leads` array.

### Changing Branding
Edit `tailwind.config.js` to update brand colors.

## 🌐 Deployment

### Vercel (Recommended)
```bash
npm run build
# Deploy dist/ folder to Vercel
```

### Netlify
```bash
npm run build
# Deploy dist/ folder to Netlify
```

## 📞 Contact

Field Property Bali
- Email: hello@fieldpropertybali.com
- WhatsApp: +62 853 3897 2901
- Instagram: @fieldpropertybali
- Website: https://www.fieldpropertybali.com

---

Built with ❤️ for Field Property Bali
