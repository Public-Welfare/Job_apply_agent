from abc import ABC, abstractmethod
from ..models import Job


class JobSource(ABC):
    @property
    @abstractmethod
    def source_name(self) -> str:
        pass

    @abstractmethod
    async def search(self, role: str, location: str, pages: int = 2) -> list[Job]:
        pass
