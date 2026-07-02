# AirWatch Deployment Guide

This guide will help you deploy AirWatch so that anyone in India (or the world!) can use it from their mobile!

## Prerequisites
- A GitHub account (you already have one!)
- A Render account (free) for backend
- A Vercel or Netlify account (free) for frontend
- Your Supabase URL/Key and Gemini API Key

## Step 1: Deploy Backend to Render

1. Go to [render.com](https://render.com) and sign up
2. Click "New +" → "Web Service"
3. Connect your GitHub repo
4. Choose "airwatch" repo, set branch to "main"
5. **Root Directory**: `backend`
6. **Runtime**: Python
7. **Build Command**: `pip install -r requirements.txt`
8. **Start Command**: `python run.py`
9. Click "Advanced" and add these environment variables:
   - `SUPABASE_URL`: your Supabase URL
   - `SUPABASE_ANON_KEY`: your Supabase anon key
   - `GEMINI_API_KEY`: your Gemini API key
   - `DEV_MODE`: `false`
10. Click "Create Web Service"

Wait for the backend to deploy! Copy its public URL (e.g., `https://airwatch-backend.onrender.com`)!

## Step 2: Deploy Frontend to Vercel

1. Go to [vercel.com](https://vercel.com) and sign up
2. Click "Add New" → "Project"
3. Import your GitHub repo
4. In "Project Settings":
   - **Framework Preset**: Vite
   - **Root Directory**: `frontend`
5. Add Environment Variable:
   - `VITE_API_URL`: your deployed backend URL (from Step 1, e.g., `https://airwatch-backend.onrender.com`)
6. Click "Deploy"

## Step 3: Test the App!

Once both are deployed, open the Vercel URL on your mobile (or any device)! It should work perfectly!

## Alternative Deploy Options

- Frontend: Netlify (similar to Vercel, just connect repo and set env vars)
- Backend: Fly.io, Railway (also free tiers available)
