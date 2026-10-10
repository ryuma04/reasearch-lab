# Second sandbox image for R-based (statistics) papers.
# Build: docker build -t tapu-sena/sandbox-r:latest sandbox-images/r
FROM rocker/r-ver:4.4.1
RUN install2.r --error --skipinstalled jsonlite data.table ggplot2 testthat randomForest glmnet
RUN useradd -m -u 1000 lab || true
USER 1000
WORKDIR /work
