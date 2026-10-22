# OJT Hours Tracker

## Overview

This is a web application that digitizes the functionality of an OJT (On-the-Job Training) log system. The app allows users to log their training hours, request supervisor verification via email, and export verified hours as PDF documents. It features a modern, responsive interface built with React and a robust Express.js backend.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Build Tool**: Vite for fast development and optimized builds
- **Styling**: Tailwind CSS with shadcn/ui component library
- **Routing**: Wouter for client-side routing
- **State Management**: TanStack Query (React Query) for server state management
- **Forms**: React Hook Form with Zod validation
- **UI Components**: Radix UI primitives with custom styling

### Backend Architecture
- **Runtime**: Node.js with Express.js framework
- **Language**: TypeScript with ES modules
- **Session Management**: Express sessions with PostgreSQL store
- **Authentication**: Password-based auth with bcrypt hashing
- **Email Service**: Resend for transactional emails
- **Development**: Hot reload with Vite middleware integration

### Database Architecture
- **Database**: PostgreSQL with Neon serverless hosting
- **ORM**: Drizzle ORM for type-safe database operations
- **Schema**: Three main entities (users, entries, supervisors)
- **Migrations**: Drizzle Kit for schema management

## Key Components

### Authentication System
- Password-based authentication with bcrypt hashing
- Session-based authentication using express-session
- PostgreSQL session store for persistence
- Admin role support for user management
- Password reset functionality with email tokens

### Entry Management
- Log training hours with date, location, method, and hours
- Support for 9 NDT (Non-Destructive Testing) methods: ET, RFT, MT, PT, RT, UT Thk., UTSW, PMI, LSI
- Batch entry creation for logging multiple sessions at once
- Running totals calculation per method
- Verification status tracking

### Supervisor Verification
- Email-based verification workflow
- Supervisor information collection (name, email, phone, certification level, company)
- Unique verification tokens for secure approval
- Email notifications with verification links
- Fallback direct verification links when email fails

### PDF Export
- Generate professional PDF reports of verified hours
- Landscape format optimized for printing
- Totals summary by NDT method
- User information header with employee details

### Admin Dashboard
- User management (view, delete users)
- Entry management (view, delete entries across all users)
- Search and filtering capabilities
- Admin-only access control

## Data Flow

1. **User Registration/Login**: Users create accounts or log in with email/password
2. **Entry Creation**: Users log training hours with method, location, date, and duration
3. **Verification Request**: Users select or create supervisor info and request verification
4. **Email Notification**: System sends verification email with unique token to supervisor
5. **Supervisor Verification**: Supervisor clicks link and confirms their identity to verify hours
6. **PDF Export**: Users can export verified hours as formatted PDF documents

## External Dependencies

### Core Dependencies
- **@neondatabase/serverless**: PostgreSQL database connectivity
- **drizzle-orm**: Type-safe database operations
- **resend**: Email delivery service
- **bcrypt**: Password hashing and verification
- **express-session**: Session management
- **connect-pg-simple**: PostgreSQL session store

### Frontend Dependencies
- **@tanstack/react-query**: Server state management
- **@hookform/resolvers**: Form validation integration
- **react-hook-form**: Form handling
- **zod**: Schema validation
- **jspdf**: PDF generation
- **axios**: HTTP client
- **wouter**: Lightweight routing

### UI Dependencies
- **@radix-ui/***: Accessible UI primitives
- **tailwindcss**: Utility-first CSS framework
- **class-variance-authority**: Component variant styling
- **lucide-react**: Icon library

## Deployment Strategy

### Development
- Vite dev server with HMR for frontend
- Express server with TypeScript compilation via tsx
- Environment variables for database and email configuration
- Replit-specific plugins for development experience

### Production Build
- Vite builds optimized static assets to `dist/public`
- ESBuild bundles server code to `dist/index.js`
- Single-command deployment with `npm run build`
- Static file serving from Express in production

### Environment Configuration
- **DATABASE_URL**: PostgreSQL connection string (required)
- **RESEND_API_KEY**: Email service API key (optional, falls back to direct links)
- **SESSION_SECRET**: Session encryption key (auto-generated if not provided)
- **NODE_ENV**: Environment mode (development/production)

### Known Issues
- PDF generation occasionally fails in development due to library conflicts
- SelectItem component errors with Radix UI in some scenarios
- Email delivery may fail without proper Resend configuration

## Changelog

- July 07, 2025. Initial setup
- July 07, 2025. Migrated email service from SendGrid to Resend

## User Preferences

Preferred communication style: Simple, everyday language.