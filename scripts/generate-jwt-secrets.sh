#!/bin/bash

echo "🔐 JWT Secret Generator for Bookmark Notion Sync"
echo "================================================="
echo ""

# Generate development secret
echo "📝 Development Environment Secret:"
DEV_SECRET=$(openssl rand -base64 32)
echo "$DEV_SECRET"
echo ""

# Generate production secret
echo "🚀 Production Environment Secret:"
PROD_SECRET=$(openssl rand -base64 32)
echo "$PROD_SECRET"
echo ""

echo "📋 Setup Instructions:"
echo "======================"
echo ""
echo "1. Development (Local Server):"
echo "   - Edit packages/server/.env"
echo "   - Add: JWT_SECRET=$DEV_SECRET"
echo ""
echo "2. Production (Vercel):"
echo "   - Run: vercel env add JWT_SECRET production"
echo "   - Paste: $PROD_SECRET"
echo ""
echo "⚠️  Security Notes:"
echo "   - Use different secrets for dev/prod"
echo "   - Never commit secrets to Git"
echo "   - Rotate every 3-6 months"
echo ""
echo "✅ Secrets generated successfully!"
