# Integration Checklist

Use this checklist to verify the Netflix-style recommendation system is properly integrated.

## Pre-Integration Verification

- [ ] All Python files created:
  - [ ] `tmdb_optimized.py` exists
  - [ ] `recommendation_engine.py` exists
  - [ ] `generate_catalog.py` exists
  - [ ] `update_system.py` exists

- [ ] All JavaScript files created/updated:
  - [ ] `recommendations.js` exists
  - [ ] `index.html` updated with `<script src="recommendations.js"></script>`
  - [ ] `search.js` unchanged (backward compatible)

- [ ] Documentation created:
  - [ ] `RECOMMENDATIONS_SETUP.md` exists
  - [ ] `QUICKSTART.md` exists
  - [ ] This checklist file exists

## Data Generation

### Step 1: Fetch TMDB Data
```bash
cd /home/akr/Desktop/scripts/atishramkhe.github.io/movies
python3 tmdb_optimized.py
```

- [ ] Script runs without errors
- [ ] Caches are created (`.tmdb_cache/` directory)
- [ ] `titles/trending.json` updated
- [ ] `titles/new.json` updated
- [ ] Posters downloaded to `posters/` directory
- [ ] Execution time < 5 minutes (cached runs should be < 1 min)

**Verify:**
```bash
# Should show multiple JSON files
ls -lh titles/*.json | head -10

# Should show recent modification time
stat titles/trending.json | grep Modify

# Should show posters
ls -1 posters/ | wc -l  # Should be > 100
```

### Step 2: Generate Recommendations
```bash
python3 generate_catalog.py
```

- [ ] Script runs without errors
- [ ] `titles/exploration_catalog.json` created (size 100KB+)
- [ ] `titles/genre_combination_feeds.json` created (size 50KB+)
- [ ] `titles/recommendation_metadata.json` created (size 100KB+)
- [ ] All scripts complete without warnings

**Verify:**
```bash
# Check files were created
ls -lh titles/exploration_catalog.json
ls -lh titles/genre_combination_feeds.json
ls -lh titles/recommendation_metadata.json

# Check file integrity
python3 -c "import json; print(json.load(open('titles/exploration_catalog.json')).keys())"
```

## Frontend Integration

### Step 1: Verify HTML Changes
```bash
grep "recommendations.js" index.html
```

- [ ] Output shows: `<script src="recommendations.js"></script>`
- [ ] Script tag appears AFTER `search.js`

**If missing, add manually:**
```html
<script src="search.js"></script>
<script src="recommendations.js"></script>
```

### Step 2: Test in Browser

1. [ ] Open website in browser: http://localhost/atishramkhe.github.io/movies/
2. [ ] Open Developer Console: Press `F12`
3. [ ] Go to Console tab
4. [ ] Look for these messages:
   - [ ] `[RecommendationSystem] Page loaded, initializing...`
   - [ ] `[RecommendationSystem] ✓ Initialized`
   - [ ] `[RecommendationSystem] System ready for recommendations`

**If not appearing, check:**
```javascript
// In console:
typeof recSystem  // Should print "object"
recSystem.isInitialized  // Should be true
```

### Step 3: Verify Data Loading

```javascript
// In browser console:
recSystem.explorationCatalog  // Should show object
recSystem.genreCombinations   // Should show object
recSystem.recommendationMetadata  // Should show object
```

- [ ] All three show as objects (not null/undefined)
- [ ] No errors in console

### Step 4: Test User Data Detection

```javascript
// Simulate adding something to watched list
localStorage.setItem('watched', JSON.stringify([{id: 550}]));
// Then refresh page

// Check if detected:
recSystem.userWatched  // Should show [550]
recSystem.userWatchLater  // Should show []
```

- [ ] User data properly detected
- [ ] Can read from localStorage

## Functionality Tests

### Test 1: Shuffled Catalogues
```javascript
// In console, run multiple times:
recSystem.getShuffledCatalog('movies').slice(0, 5)

// Then reload page and run again - should be different order
```

- [ ] Different results with 80% probability on different seeds
- [ ] No JavaScript errors

### Test 2: Genre Combinations
```javascript
// In console:
recSystem.getThematicFeed('feel_good')
recSystem.getThematicFeed('intense')
recSystem.getThematicFeed('binge_worthy')
```

- [ ] Each returns array of 50-150 title IDs
- [ ] Different themes return different IDs
- [ ] No errors

### Test 3: Personalized Recommendations
```javascript
// First, simulate user history:
localStorage.setItem('watched', JSON.stringify([{id: 550}, {id: 238}]));
recSystem.userWatched = [550, 238];

// Then get recommendations:
recSystem.getPersonalizedRecommendations(20)
```

- [ ] Returns array of title IDs
- [ ] IDs are NOT in the watched list
- [ ] Different user histories produce different recommendations

### Test 4: Grid Functionality
```javascript
// In console:
loadGridWithRecommendations('titles/trending.json', 'trendingGrid', true)
```

- [ ] Grid loads with content
- [ ] Poster cards appear
- [ ] Clicking a card opens player
- [ ] No console errors

## Performance Checks

### Backend Performance
```bash
# Measure script execution
time python3 tmdb_optimized.py

# Should be:
# - First run: 5-10 minutes
# - Second run (cached): < 1 minute
```

- [ ] First run completes in reasonable time
- [ ] Subsequent runs use cache and are <2 minutes

### Frontend Performance
```javascript
// In browser console:
performance.mark('start');
await recSystem.getPersonalizedRecommendations(100);
performance.mark('end');
performance.measure('rec', 'start', 'end');
performance.getEntriesByType('measure')[0].duration;
```

- [ ] Should complete in < 50ms
- [ ] No memory leaks (check Task Manager)
- [ ] Smooth interaction

## API Rate Limiting

### Step 1: Monitor TMDB Requests
```bash
# While running tmdb_optimized.py in one terminal,
# in another terminal, count API requests

# Option A: Check logs
grep "rate_limited_request\|Second request" update_log.txt

# Option B: Monitor network traffic
# (requires network monitoring tool)
```

- [ ] Requests are spaced out (0.3+ seconds apart)
- [ ] No "429 Too Many Requests" errors

### Step 2: Cache Hit Rate
```bash
# Check cache directory
ls .tmdb_cache/ | wc -l  # Should have many cached files

# Run script twice and compare times
time python3 tmdb_optimized.py  # First time
time python3 tmdb_optimized.py  # Second time (cached)

# Second should be 80%+ faster
```

- [ ] Second run is significantly faster
- [ ] Cache files accumulating

## User Experience Verification

### Feature 1: Varied Content Display
```javascript
// Run this multiple times:
location.reload();  // Reload page
// Look at Trending grid - order should change
```

- [ ] Content order changes between visits
- [ ] Same 5 content items cycle through different orders
- [ ] Feels fresh but not random

### Feature 2: Smart Recommendations
```javascript
// Add something to watchlater:
localStorage.setItem('watchLater', JSON.stringify([{id: 550}]));
location.reload();

// Check if recommendations appear differently:
recSystem.getPersonalizedRecommendations(10)
```

- [ ] Recommendations change based on user data
- [ ] Similar content is recommended
- [ ] No recommendations for already-watched items

### Feature 3: Genre Combinations
```javascript
// Verify new categories appear in console:
Object.keys(recSystem.genreCombinations)
```

- [ ] Should list: `['feel_good', 'intense', 'binge_worthy', 'sci_fi_fantasy', 'romantic', 'cerebral', 'escapism', 'indie_gems']`
- [ ] Each has 50+ items

## Troubleshooting Guide

### Issue: "recommendations.js fails to load"
- [ ] Check browser console for 404 error
- [ ] Verify file exists: `ls recommendations.js`
- [ ] Check HTML source: `grep recommendations.js index.html`
- [ ] Action: Copy file if missing, fix path if wrong

### Issue: "Recommendation data not loading"
- [ ] Check network tab (F12 → Network) for failed requests
- [ ] Verify files exist: `ls titles/exploration_catalog.json`
- [ ] Run: `python3 generate_catalog.py`
- [ ] Clear browser cache: `Ctrl+Shift+Delete`

### Issue: "No recommendations appearing"
- [ ] Check if `recSystem.isInitialized` is true
- [ ] Look for errors in console
- [ ] Verify JSON files are valid: `python3 -c "import json; json.load(open('titles/exploration_catalog.json'))"`
- [ ] Try force-refreshing: `Ctrl+Shift+R`

### Issue: "TMDB script running slow"
- [ ] Check if running for first time (expected: 5-10 min)
- [ ] Verify internet connection
- [ ] Check `.tmdb_cache/` directory has files (> 50 files)
- [ ] Try clearing cache: `rm -rf .tmdb_cache/`

### Issue: "Memory usage high"
- [ ] Close other browser tabs
- [ ] Check if recommendation files are huge (> 500MB)
- [ ] Reduce limit in generate_catalog.py:
  ```python
  # Change from 50 to 20-30
  exploration_catalog["all_movies"].append({...limit=20...})
  ```

## Final Verification

### Complete System Test
```bash
#!/bin/bash
echo "=== Recommendation System Verification ==="

# Check Python files
echo "Python files:"
ls -1 *.py | grep -E "(tmdb_optimized|recommendation_engine|generate_catalog|update_system)"

# Check JS files
echo -e "\nJavaScript files:"
ls -1 *.js | grep -E "(recommendations|search|index)"

# Check data files
echo -e "\nData files:"
ls -lh titles/exploration_catalog.json titles/genre_combination_feeds.json titles/recommendation_metadata.json 2>/dev/null || echo "  Data files not generated yet"

# Check HTML integration
echo -e "\nHTML integration:"
grep -c "recommendations.js" index.html

echo -e "\n=== Verification Complete ==="
```

- [ ] All Python files present
- [ ] All JavaScript files present
- [ ] Data files generated and > 50KB each
- [ ] HTML properly updated

### Sign-Off
- [ ] All checklist items complete
- [ ] No critical errors or warnings
- [ ] System ready for deployment

**Implementation Date:** ___________  
**Verified By:** ___________  
**Status:** ✅ Ready / ⚠️ Needs Attention / ❌ Failed

---

## Next Steps After Verification

1. **Test in Production**
   - Push to staging server
   - Test with real users
   - Monitor performance

2. **Monitor Metrics**
   - Track API usage (should be 80% lower)
   - Monitor page load times
   - Check recommendation click-through rates

3. **Gather Feedback**
   - Ask users if recommendations are helpful
   - Note which categories they prefer
   - Adjust tuning if needed

4. **Plan Enhancements**
   - Consider A/B testing different algorithms
   - Plan collaborative filtering
   - Design feedback loop for better recommendations

---

**Document Version:** 1.0  
**Last Updated:** 2026-02-12  
**Status:** ✅ Complete
