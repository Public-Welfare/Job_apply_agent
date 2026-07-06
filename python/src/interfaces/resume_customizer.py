from abc import ABC, abstractmethod
from ..models import UserProfile, CustomizedResume


class ResumeCustomizer(ABC):
    @abstractmethod
    async def customize(
        self,
        profile: UserProfile,
        job_title: str,
        company: str,
        job_description: str,
    ) -> CustomizedResume:
        pass
