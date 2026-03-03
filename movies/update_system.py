#!/usr/bin/env python3
"""
All-in-One Recommendation System Setup & Update Script
Runs all necessary steps to update your website with Netflix-style recommendations.

Usage:
    python3 update_system.py          # Full update
    python3 update_system.py --quick  # Quick cache update only
    python3 update_system.py --data   # Update recommendation data only
"""

import subprocess
import sys
import os
import json
from datetime import datetime
import argparse

class UpdateSystem:
    def __init__(self, movies_dir="."):
        self.movies_dir = movies_dir
        self.log_file = os.path.join(movies_dir, "update_log.txt")
        self.errors = []
        self.start_time = datetime.now()
        self.log(f"[UPDATE] Starting at {self.start_time.isoformat()}")
    
    def log(self, message, level="INFO"):
        """Log message to both console and file."""
        timestamp = datetime.now().strftime("%H:%M:%S")
        formatted = f"[{timestamp}] {level}: {message}"
        print(formatted)
        
        try:
            with open(self.log_file, 'a', encoding='utf-8') as f:
                f.write(formatted + "\n")
        except:
            pass
    
    def run_command(self, cmd, description):
        """Run a command and log output."""
        self.log(f"▶ {description}...", "INFO")
        try:
            result = subprocess.run(
                cmd,
                cwd=self.movies_dir,
                capture_output=True,
                text=True,
                timeout=1800  # 30 minute timeout
            )
            
            if result.returncode == 0:
                self.log(f"✓ {description}", "SUCCESS")
                if result.stdout:
                    for line in result.stdout.split('\n'):
                        if line.strip():
                            self.log(f"  {line}", "OUTPUT")
                return True
            else:
                error_msg = f"Failed: {description}"
                self.log(error_msg, "ERROR")
                self.log(f"  Error output: {result.stderr}", "ERROR")
                self.errors.append(error_msg)
                return False
                
        except subprocess.TimeoutExpired:
            error_msg = f"Timeout: {description} (>30 min)"
            self.log(error_msg, "ERROR")
            self.errors.append(error_msg)
            return False
        except Exception as e:
            error_msg = f"Exception in {description}: {str(e)}"
            self.log(error_msg, "ERROR")
            self.errors.append(error_msg)
            return False
    
    def verify_files(self):
        """Verify all necessary files exist."""
        self.log("Verifying files...", "INFO")
        
        required_files = [
            "tmdb_optimized.py",
            "recommendation_engine.py",
            "generate_catalog.py",
            "recommendations.js",
            "index.html",
            "search.js"
        ]
        
        missing = []
        for filename in required_files:
            filepath = os.path.join(self.movies_dir, filename)
            if not os.path.exists(filepath):
                missing.append(filename)
        
        if missing:
            self.log(f"Missing files: {', '.join(missing)}", "WARNING")
            return False
        
        self.log("All files verified", "SUCCESS")
        return True
    
    def check_python_deps(self):
        """Check if required Python packages are available."""
        self.log("Checking Python dependencies...", "INFO")
        
        try:
            import requests
            import json
            self.log("✓ requests module available", "SUCCESS")
            return True
        except ImportError as e:
            self.log(f"Missing module: {e}", "ERROR")
            self.log("Install with: pip install requests", "INFO")
            return False
    
    def full_update(self):
        """Run full update: fetch data + generate recommendations."""
        self.log("\n" + "="*60, "INFO")
        self.log("FULL UPDATE: All steps", "INFO")
        self.log("="*60, "INFO")
        
        if not self.verify_files():
            self.log("File verification failed", "ERROR")
            return False
        
        if not self.check_python_deps():
            self.log("Dependency check failed", "ERROR")
            return False
        
        # Step 1: Fetch TMDB data (optimized)
        if not self.run_command(
            [sys.executable, "tmdb_optimized.py"],
            "Fetching TMDB data (optimized)"
        ):
            self.log("TMDB fetch failed - continuing with cached data", "WARNING")
        
        # Step 2: Generate recommendation data
        if not self.run_command(
            [sys.executable, "generate_catalog.py"],
            "Generating recommendation metadata"
        ):
            self.log("Recommendation generation failed", "ERROR")
            return False
        
        # Step 3: Verify generated files
        if not self.verify_generated_files():
            self.log("Generated files verification failed", "WARNING")
        
        return len(self.errors) == 0
    
    def quick_update(self):
        """Quick update: just refresh cached data."""
        self.log("\n" + "="*60, "INFO")
        self.log("QUICK UPDATE: TMDB data only", "INFO")
        self.log("="*60, "INFO")
        
        return self.run_command(
            [sys.executable, "tmdb_optimized.py"],
            "Fetching TMDB data (optimized)"
        )
    
    def data_only_update(self):
        """Update only recommendation data (use existing TMDB data)."""
        self.log("\n" + "="*60, "INFO")
        self.log("DATA ONLY UPDATE: Generate recommendations", "INFO")
        self.log("="*60, "INFO")
        
        return self.run_command(
            [sys.executable, "generate_catalog.py"],
            "Generating recommendation metadata"
        )
    
    def verify_generated_files(self):
        """Verify all expected output files were created."""
        self.log("\nVerifying generated files...", "INFO")
        
        expected_files = {
            "titles/trending.json": "Trending titles",
            "titles/new.json": "New releases",
            "titles/exploration_catalog.json": "Exploration catalog",
            "titles/genre_combination_feeds.json": "Genre combinations",
            "titles/recommendation_metadata.json": "Recommendation metadata",
        }
        
        all_exist = True
        for filepath, description in expected_files.items():
            full_path = os.path.join(self.movies_dir, filepath)
            if os.path.exists(full_path):
                size_kb = os.path.getsize(full_path) / 1024
                self.log(f"✓ {description}: {size_kb:.1f}KB", "SUCCESS")
            else:
                self.log(f"✗ Missing: {description}", "WARNING")
                all_exist = False
        
        return all_exist
    
    def print_summary(self):
        """Print update summary."""
        duration = datetime.now() - self.start_time
        
        self.log("\n" + "="*60, "INFO")
        self.log("UPDATE SUMMARY", "INFO")
        self.log("="*60, "INFO")
        
        self.log(f"Duration: {duration}", "INFO")
        self.log(f"Errors: {len(self.errors)}", "INFO")
        
        if self.errors:
            self.log("\nErrors encountered:", "WARNING")
            for error in self.errors:
                self.log(f"  - {error}", "WARNING")
        
        self.log(f"\nLog file: {self.log_file}", "INFO")
        self.log("="*60, "INFO")


def main():
    parser = argparse.ArgumentParser(
        description="Update Ateaish Movies with Recommendation System"
    )
    parser.add_argument(
        "--quick",
        action="store_true",
        help="Quick update: TMDB data only"
    )
    parser.add_argument(
        "--data",
        action="store_true",
        help="Data only: Generate recommendations from existing TMDB data"
    )
    parser.add_argument(
        "--dir",
        default=".",
        help="Movies directory (default: current directory)"
    )
    
    args = parser.parse_args()
    
    # Change to movies directory if specified
    if args.dir and args.dir != ".":
        try:
            os.chdir(args.dir)
        except Exception as e:
            print(f"Error: Cannot change to directory {args.dir}: {e}")
            sys.exit(1)
    
    updater = UpdateSystem(args.dir)
    
    try:
        if args.quick:
            success = updater.quick_update()
        elif args.data:
            success = updater.data_only_update()
        else:
            success = updater.full_update()
        
        updater.print_summary()
        
        sys.exit(0 if success else 1)
        
    except KeyboardInterrupt:
        updater.log("\n[Interrupted by user]", "WARNING")
        sys.exit(1)
    except Exception as e:
        updater.log(f"Unexpected error: {e}", "ERROR")
        sys.exit(1)


if __name__ == "__main__":
    main()
