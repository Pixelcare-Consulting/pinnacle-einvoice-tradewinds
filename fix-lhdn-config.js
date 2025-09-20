require('dotenv').config();
const { PrismaClient } = require('./src/generated/prisma');

async function fixLHDNConfiguration() {
    const prisma = new PrismaClient({
        log: ['error', 'warn']
    });
    
    try {
        console.log('🔍 Checking current LHDN configuration...');
        
        // Get current LHDN configuration
        const currentConfig = await prisma.wP_CONFIGURATION.findFirst({
            where: {
                Type: 'LHDN',
                IsActive: true
            },
            orderBy: {
                CreateTS: 'desc'
            }
        });
        
        if (currentConfig) {
            console.log('📋 Current LHDN Configuration:');
            console.log('ID:', currentConfig.ID);
            console.log('Settings:', currentConfig.Settings);
            
            // Parse settings to check for problematic URLs
            let settings;
            try {
                settings = typeof currentConfig.Settings === 'string' 
                    ? JSON.parse(currentConfig.Settings) 
                    : currentConfig.Settings;
                    
                console.log('📊 Parsed Settings:', JSON.stringify(settings, null, 2));
                
                // Check for paceserver references
                const settingsString = JSON.stringify(settings);
                if (settingsString.includes('paceserver') || settingsString.includes('ddns.net')) {
                    console.log('⚠️  Found problematic server reference in LHDN configuration!');
                    console.log('🔧 This needs to be updated to use proper LHDN endpoints.');
                    
                    // Suggest correct configuration
                    const correctedSettings = {
                        ...settings,
                        environment: settings.environment || 'sandbox',
                        productionUrl: 'https://api.myinvois.hasil.gov.my',
                        sandboxUrl: 'https://preprod-api.myinvois.hasil.gov.my',
                        middlewareUrl: settings.environment === 'production' 
                            ? 'https://api.myinvois.hasil.gov.my'
                            : 'https://preprod-api.myinvois.hasil.gov.my'
                    };
                    
                    // Remove any paceserver references
                    Object.keys(correctedSettings).forEach(key => {
                        if (typeof correctedSettings[key] === 'string' && 
                            (correctedSettings[key].includes('paceserver') || 
                             correctedSettings[key].includes('ddns.net'))) {
                            console.log(`🗑️  Removing problematic URL from ${key}: ${correctedSettings[key]}`);
                            delete correctedSettings[key];
                        }
                    });
                    
                    console.log('✅ Suggested corrected settings:');
                    console.log(JSON.stringify(correctedSettings, null, 2));
                    
                    // Apply the fix automatically
                    console.log('🔧 Applying the fix...');
                    await prisma.wP_CONFIGURATION.update({
                        where: { ID: currentConfig.ID },
                        data: {
                            Settings: JSON.stringify(correctedSettings),
                            UpdateTS: new Date()
                        }
                    });
                    console.log('✅ LHDN configuration updated successfully!');
                    
                } else {
                    console.log('✅ No problematic server references found in LHDN configuration.');
                }
                
            } catch (parseError) {
                console.error('❌ Error parsing LHDN settings:', parseError);
            }
            
        } else {
            console.log('⚠️  No active LHDN configuration found in database.');
        }
        
        // Check for any other configurations with paceserver references
        console.log('\n🔍 Checking for any other configurations with paceserver references...');
        const problematicConfigs = await prisma.wP_CONFIGURATION.findMany({
            where: {
                OR: [
                    { Settings: { contains: 'paceserver' } },
                    { Settings: { contains: 'ddns.net' } }
                ]
            }
        });
        
        if (problematicConfigs.length > 0) {
            console.log(`⚠️  Found ${problematicConfigs.length} configuration(s) with paceserver references:`);
            problematicConfigs.forEach(config => {
                console.log(`- ID: ${config.ID}, Type: ${config.Type}, Active: ${config.IsActive}`);
                console.log(`  Settings: ${config.Settings}`);
            });
        } else {
            console.log('✅ No other configurations with paceserver references found.');
        }
        
    } catch (error) {
        console.error('❌ Error checking LHDN configuration:', error);
    } finally {
        await prisma.$disconnect();
    }
}

// Run the check
fixLHDNConfiguration();
