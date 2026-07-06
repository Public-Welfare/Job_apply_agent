import json
from typing import Optional
from pydantic import BaseModel, Field
from .config import config


class PersonalInfo(BaseModel):
    name: str
    email: str
    phone: str
    linkedin: str
    github: str
    location: str
    codeforces: Optional[str] = ""


class Skills(BaseModel):
    languages: list[str] = []
    frameworks: list[str] = []
    tools: list[str] = []
    databases: list[str] = []


class Experience(BaseModel):
    company: str
    role: str
    duration: str
    location: str
    bullets: list[str]


class Education(BaseModel):
    institution: str
    degree: str
    year: str
    gpa: Optional[str] = ""
    coursework: Optional[str] = ""


class Project(BaseModel):
    name: str
    description: str
    tech: list[str]
    link: Optional[str] = ""


class UserPreferences(BaseModel):
    roles: list[str]
    locations: list[str]
    min_salary_lpa: int = 0
    avoid_keywords: list[str] = []
    avoid_companies: list[str] = []


class UserProfile(BaseModel):
    personal: PersonalInfo
    summary: str
    skills: Skills
    experience: list[Experience]
    education: list[Education]
    projects: list[Project]
    achievements: list[str] = []
    preferences: UserPreferences


class Job(BaseModel):
    id: str
    title: str
    company: str
    location: str = ""
    salary: str = ""
    apply_url: str
    description: str = ""
    source: str = ""


class CustomizedResume(BaseModel):
    keywords_matched: list[str] = []
    personal: PersonalInfo
    summary: str
    skills: Skills
    experience: list[Experience]
    education: list[Education]
    projects: list[Project]
    achievements: list[str] = []


class ApplicationEntry(BaseModel):
    id: str
    title: str
    company: str
    location: str = ""
    salary: str = ""
    source: str = ""
    apply_url: str
    resume_path: str
    description: str = ""
    keywords_matched: list[str] = []
    status: str = "applied"
    applied_at: str
    updated_at: str
    notes: str = ""


def load_profile() -> UserProfile:
    with open(config.PROFILE_PATH, encoding="utf-8") as f:
        return UserProfile.model_validate(json.load(f))
