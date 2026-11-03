"""
Multi-portal job scrapers for Singapore.
Uses Playwright to scrape public job listings from various portals.
"""

import asyncio
import re
from typing import Optional
from datetime import datetime
from playwright.async_api import async_playwright, Page

# Re-use JobListing model from main
from main import JobListing


async def scrape_jobstreet(
    query: str,
    limit: int = 20,
) -> list[JobListing]:
    """Scrape JobStreet Singapore."""
    jobs = []
    url = f"https://www.jobstreet.com.sg/en/jobs/search/{query.replace(' ', '-')}"

    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            context = await browser.new_context(
                viewport={"width": 1280, "height": 900},
                user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                locale="en-SG",
            )
            page = await context.new_page()
            await page.goto(url, wait_until="domcontentloaded", timeout=30000)
            await page.wait_for_timeout(3000)  # Wait for JS rendering

            # Try to extract job cards
            job_cards = await page.query_selector_all('[data-testid="job-card"], .job-card, [class*="job-card"], [class*="JobCard"]')

            for card in job_cards[:limit]:
                try:
                    title_el = await card.query_selector('h3 a, [class*="title"], a[class*="job"]')
                    company_el = await card.query_selector('[class*="company"], span[class*="company"]')
                    location_el = await card.query_selector('[class*="location"], span[class*="location"]')
                    salary_el = await card.query_selector('[class*="salary"], span[class*="salary"]')

                    title = (await title_el.inner_text()) if title_el else ""
                    company = (await company_el.inner_text()) if company_el else ""
                    location = (await location_el.inner_text()) if location_el else ""
                    salary_text = (await salary_el.inner_text()) if salary_el else ""

                    # Parse salary
                    salary_min, salary_max = None, None
                    if salary_text:
                        nums = re.findall(r'\d+', salary_text)
                        if len(nums) >= 2:
                            salary_min, salary_max = int(nums[0]), int(nums[1])
                        elif len(nums) == 1:
                            salary_min = int(nums[0])

                    # Get job link
                    link_el = await card.query_selector('a[href*="/job/"]')
                    job_url = ""
                    if link_el:
                        href = await link_el.get_attribute("href")
                        if href:
                            job_url = href if href.startswith("http") else f"https://www.jobstreet.com.sg{href}"

                    if title and company:
                        jobs.append(JobListing(
                            uuid=f"jobstreet_{len(jobs)}_{datetime.now().timestamp()}",
                            title=title.strip(),
                            company=company.strip(),
                            salary_min=salary_min,
                            salary_max=salary_max,
                            salary_type="Monthly",
                            skills=[],
                            experience_required=0,
                            location=location.strip() if location else "Singapore",
                            district="",
                            region="",
                            employment_type="",
                            position_level="",
                            description="",
                            job_url=job_url,
                            posted_date="",
                            views=0,
                            applications=0,
                            match_score=0.0,
                        ))
                except Exception:
                    continue

            await browser.close()

    except Exception as e:
        print(f"JobStreet scrape error: {e}")

    return jobs


async def scrape_indeed_sg(
    query: str,
    limit: int = 20,
) -> list[JobListing]:
    """Scrape Indeed Singapore."""
    jobs = []
    url = f"https://sg.indeed.com/jobs?q={query.replace(' ', '+')}&l=Singapore"

    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            context = await browser.new_context(
                viewport={"width": 1280, "height": 900},
                user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                locale="en-SG",
            )
            page = await context.new_page()
            await page.goto(url, wait_until="domcontentloaded", timeout=30000)
            await page.wait_for_timeout(3000)

            # Indeed job cards
            job_cards = await page.query_selector_all('div[data-tn-component="organicJob"], div.job_seen_beacon, li[data-jk]')

            for card in job_cards[:limit]:
                try:
                    title_el = await card.query_selector('h2 a, span.jobTitle, a[data-testid="job-title"]')
                    company_el = await card.query_selector('span.companyName, span.css-')
                    location_el = await card.query_selector('span.companyLocation, div[class*="location"]')
                    salary_el = await card.query_selector('span.css-12jf6yh, span.salary-snippet-text')

                    title = (await title_el.inner_text()) if title_el else ""
                    company = (await company_el.inner_text()) if company_el else ""
                    location = (await location_el.inner_text()) if location_el else ""
                    salary_text = (await salary_el.inner_text()) if salary_el else ""

                    salary_min, salary_max = None, None
                    if salary_text:
                        nums = re.findall(r'\d+', salary_text)
                        if len(nums) >= 2:
                            salary_min, salary_max = int(nums[0]), int(nums[1])
                        elif len(nums) == 1:
                            salary_min = int(nums[0])

                    link_el = await card.query_selector('h2 a, a[data-testid="job-title"]')
                    job_url = ""
                    if link_el:
                        href = await link_el.get_attribute("href")
                        if href:
                            job_url = href if href.startswith("http") else f"https://sg.indeed.com{href}"

                    if title:
                        jobs.append(JobListing(
                            uuid=f"indeed_{len(jobs)}_{datetime.now().timestamp()}",
                            title=title.strip(),
                            company=company.strip() if company else "Unknown",
                            salary_min=salary_min,
                            salary_max=salary_max,
                            salary_type="Monthly",
                            skills=[],
                            experience_required=0,
                            location=location.strip() if location else "Singapore",
                            district="",
                            region="",
                            employment_type="",
                            position_level="",
                            description="",
                            job_url=job_url,
                            posted_date="",
                            views=0,
                            applications=0,
                            match_score=0.0,
                        ))
                except Exception:
                    continue

            await browser.close()

    except Exception as e:
        print(f"Indeed scrape error: {e}")

    return jobs


async def scrape_linkedin_jobs(
    query: str,
    limit: int = 20,
) -> list[JobListing]:
    """Scrape LinkedIn Jobs Singapore (public listings)."""
    jobs = []
    url = f"https://www.linkedin.com/jobs/search?keywords={query.replace(' ', '+')}&location=Singapore&f_TPR=r604800"

    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            context = await browser.new_context(
                viewport={"width": 1280, "height": 900},
                user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                locale="en-SG",
            )
            page = await context.new_page()
            await page.goto(url, wait_until="domcontentloaded", timeout=30000)
            await page.wait_for_timeout(4000)

            # LinkedIn job cards
            job_cards = await page.query_selector_all('div[data-control-name="click_title"], li[data-views], div.job-card-container')

            for card in job_cards[:limit]:
                try:
                    title_el = await card.query_selector('h3 a, a.job-title, h4.base-search-card__title')
                    company_el = await card.query_selector('h4.base-search-card__subtitle, span.company-name')
                    location_el = await card.query_selector('span.job-search-card__location, span.company-location')

                    title = (await title_el.inner_text()) if title_el else ""
                    company = (await company_el.inner_text()) if company_el else ""
                    location = (await location_el.inner_text()) if location_el else ""

                    link_el = await card.query_selector('h3 a, a.job-title')
                    job_url = ""
                    if link_el:
                        href = await link_el.get_attribute("href")
                        if href:
                            job_url = href if href.startswith("http") else f"https://www.linkedin.com{href}"

                    if title:
                        jobs.append(JobListing(
                            uuid=f"linkedin_{len(jobs)}_{datetime.now().timestamp()}",
                            title=title.strip(),
                            company=company.strip() if company else "Unknown",
                            salary_min=None,
                            salary_max=None,
                            salary_type="Monthly",
                            skills=[],
                            experience_required=0,
                            location=location.strip() if location else "Singapore",
                            district="",
                            region="",
                            employment_type="",
                            position_level="",
                            description="",
                            job_url=job_url,
                            posted_date="",
                            views=0,
                            applications=0,
                            match_score=0.0,
                        ))
                except Exception:
                    continue

            await browser.close()

    except Exception as e:
        print(f"LinkedIn scrape error: {e}")

    return jobs


async def scrape_glassdoor_sg(
    query: str,
    limit: int = 20,
) -> list[JobListing]:
    """Scrape Glassdoor Singapore jobs."""
    jobs = []
    url = f"https://www.glassdoor.com.sg/Job/singapore-{query.replace(' ', '-')}-jobs-SV_IL.0,8_IM719.htm"

    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            context = await browser.new_context(
                viewport={"width": 1280, "height": 900},
                user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                locale="en-SG",
            )
            page = await context.new_page()
            await page.goto(url, wait_until="domcontentloaded", timeout=30000)
            await page.wait_for_timeout(3000)

            job_cards = await page.query_selector_all('div.jd, div[data-testid="job-card"], article')

            for card in job_cards[:limit]:
                try:
                    title_el = await card.query_selector('a.jd-job-title, h2 a, a[class*="title"]')
                    company_el = await card.query_selector('span.jd-company, span[class*="company"]')
                    location_el = await card.query_selector('span.jd-location, span[class*="location"]')
                    salary_el = await card.query_selector('span.jd-salary, span[class*="salary"]')

                    title = (await title_el.inner_text()) if title_el else ""
                    company = (await company_el.inner_text()) if company_el else ""
                    location = (await location_el.inner_text()) if location_el else ""
                    salary_text = (await salary_el.inner_text()) if salary_el else ""

                    salary_min, salary_max = None, None
                    if salary_text:
                        nums = re.findall(r'\d+', salary_text)
                        if len(nums) >= 2:
                            salary_min, salary_max = int(nums[0]), int(nums[1])
                        elif len(nums) == 1:
                            salary_min = int(nums[0])

                    link_el = await card.query_selector('a.jd-job-title, h2 a')
                    job_url = ""
                    if link_el:
                        href = await link_el.get_attribute("href")
                        if href:
                            job_url = href if href.startswith("http") else f"https://www.glassdoor.com.sg{href}"

                    if title:
                        jobs.append(JobListing(
                            uuid=f"glassdoor_{len(jobs)}_{datetime.now().timestamp()}",
                            title=title.strip(),
                            company=company.strip() if company else "Unknown",
                            salary_min=salary_min,
                            salary_max=salary_max,
                            salary_type="Monthly",
                            skills=[],
                            experience_required=0,
                            location=location.strip() if location else "Singapore",
                            district="",
                            region="",
                            employment_type="",
                            position_level="",
                            description="",
                            job_url=job_url,
                            posted_date="",
                            views=0,
                            applications=0,
                            match_score=0.0,
                        ))
                except Exception:
                    continue

            await browser.close()

    except Exception as e:
        print(f"Glassdoor scrape error: {e}")

    return jobs


async def scrape_all_portals(
    query: str,
    limit: int = 30,
    sources: Optional[list[str]] = None,
) -> list[JobListing]:
    """
    Scrape jobs from all available portals.
    
    Sources: 'mcf' (MyCareersFuture API), 'jobstreet', 'indeed', 'linkedin', 'glassdoor'
    """
    if sources is None:
        sources = ["mcf", "jobstreet", "indeed", "linkedin", "glassdoor"]
    
    all_jobs = []
    per_source = max(1, limit // len(sources))
    
    # Import MCF search
    from main import search_mcf_jobs
    
    tasks = []
    
    if "mcf" in sources:
        tasks.append(search_mcf_jobs(query, limit=per_source))
    
    if "jobstreet" in sources:
        tasks.append(scrape_jobstreet(query, limit=per_source))
    
    if "indeed" in sources:
        tasks.append(scrape_indeed_sg(query, limit=per_source))
    
    if "linkedin" in sources:
        tasks.append(scrape_linkedin_jobs(query, limit=per_source))
    
    if "glassdoor" in sources:
        tasks.append(scrape_glassdoor_sg(query, limit=per_source))
    
    # Run all scrapers in parallel
    results = await asyncio.gather(*tasks, return_exceptions=True)
    
    for result in results:
        if isinstance(result, list):
            all_jobs.extend(result)
        elif isinstance(result, Exception):
            print(f"Scraper error: {result}")
    
    # Deduplicate by title + company
    seen = set()
    unique_jobs = []
    for job in all_jobs:
        key = f"{job.title.lower()}_{job.company.lower()}"
        if key not in seen:
            seen.add(key)
            unique_jobs.append(job)
    
    return unique_jobs[:limit]
