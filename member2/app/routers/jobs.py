from collections.abc import Callable

from fastapi import APIRouter, Depends, HTTPException, Request, status

from ..job_models import (
    CreateScrapingJobInput,
    ProductResult,
    ScrapingExecution,
    ScrapingJob,
)
from ..job_service import (
    JobConfigurationError,
    JobConflictError,
    JobNotFoundError,
    ScrapingJobService,
)


router = APIRouter(prefix="/jobs", tags=["scraping-jobs"])


def get_job_service(request: Request) -> ScrapingJobService:
    service = getattr(request.app.state, "scraping_job_service", None)
    if service is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Scraping job management is not configured.",
        )
    return service


@router.post(
    "",
    response_model=ScrapingJob,
    status_code=status.HTTP_201_CREATED,
)
def create_job(
    payload: CreateScrapingJobInput,
    service: ScrapingJobService = Depends(get_job_service),
) -> ScrapingJob:
    try:
        return service.create_job(payload)
    except JobConfigurationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("", response_model=list[ScrapingJob])
def list_jobs(
    service: ScrapingJobService = Depends(get_job_service),
) -> list[ScrapingJob]:
    return service.list_jobs()


@router.get("/{job_id}", response_model=ScrapingJob)
def get_job(
    job_id: str,
    service: ScrapingJobService = Depends(get_job_service),
) -> ScrapingJob:
    try:
        return service.get_job(job_id)
    except JobNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/{job_id}/executions", response_model=list[ScrapingExecution])
def list_executions(
    job_id: str,
    service: ScrapingJobService = Depends(get_job_service),
) -> list[ScrapingExecution]:
    try:
        return service.list_executions(job_id)
    except JobNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get(
    "/{job_id}/executions/{execution_id}/results",
    response_model=list[ProductResult],
)
def get_execution_results(
    job_id: str,
    execution_id: str,
    service: ScrapingJobService = Depends(get_job_service),
) -> list[ProductResult]:
    try:
        return service.get_results(job_id, execution_id)
    except JobNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/{job_id}/start", response_model=ScrapingJob)
def start_job(
    job_id: str,
    service: ScrapingJobService = Depends(get_job_service),
) -> ScrapingJob:
    return _run_action(lambda: service.start_job(job_id))


@router.post("/{job_id}/pause", response_model=ScrapingJob)
def pause_job(
    job_id: str,
    service: ScrapingJobService = Depends(get_job_service),
) -> ScrapingJob:
    return _run_action(lambda: service.pause_job(job_id))


@router.post("/{job_id}/resume", response_model=ScrapingJob)
def resume_job(
    job_id: str,
    service: ScrapingJobService = Depends(get_job_service),
) -> ScrapingJob:
    return _run_action(lambda: service.resume_job(job_id))


@router.post("/{job_id}/cancel", response_model=ScrapingJob)
def cancel_job(
    job_id: str,
    service: ScrapingJobService = Depends(get_job_service),
) -> ScrapingJob:
    return _run_action(lambda: service.cancel_job(job_id))


def _run_action(action: Callable[[], ScrapingJob]) -> ScrapingJob:
    try:
        return action()
    except JobNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except JobConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except JobConfigurationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
